/**
 * "Load a real device": find an Entra device by name and read the groups it is
 * actually in, so the simulator can start from a real endpoint rather than a
 * hand-picked one.
 *
 * These are on-demand reads, not part of the tenant load: one search per few
 * keystrokes and one membership read per device chosen. Both need
 * `Device.Read.All`, which is optional -- without it Graph answers 403 and the
 * caller gets `unavailable` with the permission named, the way the Apps view
 * does, rather than an error.
 */

import {
  DEVICE_ACTIVE_DAYS,
  DEVICE_GRAPH_PERMISSION,
  platformFromOperatingSystem,
  readPhysicalIds,
  type DeviceLookupUnavailable,
  type DeviceMembership,
  type DeviceMembershipResponse,
  type DeviceSearchResponse,
  type DeviceSearchResult,
  type Platform,
} from "@intune-preflight/shared";
import { platformFromAssignmentFilter } from "@intune-preflight/engine";
import { type GraphClient, isGraphStatus } from "./graphClient.js";

const DEVICE_FIELDS = "id,displayName,operatingSystem,operatingSystemVersion,trustType";
/** What the search filters on; read alongside DEVICE_FIELDS, never shown. */
const MANAGEMENT_FIELDS = "accountEnabled,isManaged,mdmAppId,approximateLastSignInDateTime";
/** Enough to pick from; a name precise enough to matter is in the first page. */
const SEARCH_LIMIT = 15;
/**
 * How many name matches to read before filtering. Stale, registered-only and
 * duplicate Autopilot records can outnumber the managed devices for a name.
 */
const SEARCH_READ = 100;
/** Microsoft Intune's application id, as Entra records it in a device's `mdmAppId`. */
const INTUNE_MDM_APP_ID = "0000000a-0000-0000-c000-000000000000";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailableFrom(err: unknown, action: string): DeviceLookupUnavailable {
  if (isGraphStatus(err, 401, 403)) {
    return {
      reason: "permission",
      detail: `Microsoft Graph refused to ${action}. Grant ${DEVICE_GRAPH_PERMISSION} to load real devices.`,
    };
  }
  console.warn(`Device lookup failed: ${(err as Error).message}`);
  return { reason: "error", detail: `Could not ${action}. Try again; if it persists, check the server log.` };
}

function toResult(raw: Record<string, unknown>): DeviceSearchResult {
  return {
    id: raw.id as string,
    displayName: (raw.displayName as string) ?? (raw.id as string),
    ...(raw.operatingSystem ? { operatingSystem: raw.operatingSystem as string } : {}),
    ...(raw.operatingSystemVersion ? { operatingSystemVersion: raw.operatingSystemVersion as string } : {}),
    ...(raw.trustType ? { trustType: raw.trustType as string } : {}),
  };
}

/**
 * Whether a device is one Intune actively manages: enabled in Entra, enrolled
 * in an MDM, and that MDM is Intune (not Configuration Manager alone or a
 * third-party MDM), and signed in within DEVICE_ACTIVE_DAYS days. A device
 * Entra has no sign-in time for is kept rather than guessed stale.
 */
export function isActiveIntuneDevice(raw: Record<string, unknown>, now: number = Date.now()): boolean {
  if (raw.accountEnabled === false) return false;
  if (raw.isManaged !== true) return false;
  if (typeof raw.mdmAppId === "string" && raw.mdmAppId.toLowerCase() !== INTUNE_MDM_APP_ID) return false;
  const lastSignIn =
    typeof raw.approximateLastSignInDateTime === "string" ? Date.parse(raw.approximateLastSignInDateTime) : NaN;
  if (!Number.isNaN(lastSignIn) && now - lastSignIn > DEVICE_ACTIVE_DAYS * 86_400_000) return false;
  return true;
}

/**
 * Active, Intune-managed devices whose display name starts with `query`. A
 * prefix match is what the devices collection filters without advanced-query
 * headers, and device names are usually typed from their start; the
 * management filter runs here, on what Graph returns, for the same reason.
 */
export async function searchDevices(client: GraphClient, query: string): Promise<DeviceSearchResponse> {
  const text = query.trim();
  if (text.length < 2) return { devices: [] };
  // OData escapes a quote by doubling it; nothing else in a name can leave the literal.
  const literal = text.replace(/'/g, "''");
  try {
    const page = await client.graphGetObject<{ value?: Record<string, unknown>[] }>(
      `/devices?$filter=startswith(displayName,'${encodeURIComponent(literal)}')&$select=${DEVICE_FIELDS},${MANAGEMENT_FIELDS}&$top=${SEARCH_READ}`
    );
    const all = page?.value ?? [];
    const kept = all.filter((raw) => isActiveIntuneDevice(raw));
    const devices = kept.map(toResult);
    devices.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
    const hidden = all.length - kept.length;
    return { devices: devices.slice(0, SEARCH_LIMIT), ...(hidden > 0 ? { hidden } : {}) };
  } catch (err) {
    return { unavailable: unavailableFrom(err, "search devices") };
  }
}

/** What `evaluateAssignmentFilter` returns: a report table, one row per matching device. */
interface FilterEvaluation {
  Columns?: { Name?: string }[];
  Values?: unknown[][];
}

/**
 * Which of the tenant's device Assignment Filters for `platform` the device
 * named `deviceName` matches, as Intune itself evaluates them: the same
 * evaluation as "Preview devices" on a filter in the admin center, run with
 * the device's name as the search. Intune's rows carry its own managed-device
 * id rather than the Entra one, so a row counts as this device when its name
 * is the device's name.
 *
 * App filters (managed-app filters for app protection) are skipped: they
 * judge an app, not the device.
 */
export async function evaluateDeviceFilters(
  client: GraphClient,
  deviceName: string,
  platform: Platform
): Promise<{ id: string; displayName: string; matches: boolean }[]> {
  const all = await client.graphGetCollection<Record<string, unknown>>(
    "/deviceManagement/assignmentFilters?$select=id,displayName,platform,rule,assignmentFilterManagementType",
    true
  );
  const filters = all.filter(
    (f) =>
      f.assignmentFilterManagementType !== "apps" &&
      typeof f.rule === "string" &&
      platformFromAssignmentFilter(f.platform as string | undefined) === platform
  );
  const name = deviceName.toLowerCase();
  return client.mapWithConcurrency(filters, client.concurrency, async (f) => {
    const report = await client.graphPostAction<FilterEvaluation>(
      "/deviceManagement/evaluateAssignmentFilter",
      { data: { platform: f.platform, rule: f.rule, top: 50, skip: 0, search: deviceName } },
      true
    );
    const nameColumn = (report?.Columns ?? []).findIndex((c) => c.Name === "deviceName");
    const matches =
      nameColumn >= 0 && (report?.Values ?? []).some((row) => String(row[nameColumn] ?? "").toLowerCase() === name);
    return { id: f.id as string, displayName: (f.displayName as string) ?? (f.id as string), matches };
  });
}

/** Never fails the device read: a filter problem is reported beside the groups. */
async function filtersFor(
  client: GraphClient,
  deviceName: string,
  platform: Platform | undefined
): Promise<Pick<DeviceMembership, "filters" | "filtersUnchecked">> {
  if (!platform) return { filters: [] };
  try {
    return { filters: await evaluateDeviceFilters(client, deviceName, platform) };
  } catch (err) {
    if (isGraphStatus(err, 401, 403)) {
      return {
        filtersUnchecked:
          "Microsoft Graph refused to evaluate Assignment Filters. Grant DeviceManagementConfiguration.Read.All, or tick the filters this device matches by hand.",
      };
    }
    console.warn(`Assignment Filter evaluation failed: ${(err as Error).message}`);
    return {
      filtersUnchecked: "Intune could not evaluate the Assignment Filters. Tick the ones this device matches by hand.",
    };
  }
}

/** One device's facts and every group it is in, directly or through nesting. */
export async function readDeviceMembership(client: GraphClient, id: string): Promise<DeviceMembershipResponse> {
  if (!GUID.test(id)) return { unavailable: { reason: "error", detail: "That is not a device id." } };
  try {
    const raw = await client.graphGetObject<Record<string, unknown>>(
      `/devices/${id}?$select=${DEVICE_FIELDS},physicalIds,enrollmentProfileName`
    );
    const groups = await client.graphGetCollection<Record<string, unknown>>(
      `/devices/${id}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName,groupTypes,membershipRule`
    );
    const device = toResult(raw);
    const { isAutopilot, groupTag } = readPhysicalIds(raw.physicalIds as string[] | undefined);
    const platform = platformFromOperatingSystem(device.operatingSystem);
    const filterResult = await filtersFor(client, device.displayName, platform);
    return {
      membership: {
        device,
        ...(platform ? { platform } : {}),
        isAutopilot,
        ...(groupTag ? { groupTag } : {}),
        ...(raw.enrollmentProfileName ? { enrollmentProfileName: raw.enrollmentProfileName as string } : {}),
        groups: groups
          .filter((g) => typeof g.id === "string")
          .map((g) => {
            const dynamic = ((g.groupTypes as string[] | undefined) ?? []).includes("DynamicMembership");
            return {
              id: g.id as string,
              displayName: (g.displayName as string) ?? (g.id as string),
              ...(dynamic ? { isDynamic: true } : {}),
              ...(g.membershipRule ? { membershipRule: g.membershipRule as string } : {}),
            };
          }),
        ...filterResult,
      },
    };
  } catch (err) {
    return { unavailable: unavailableFrom(err, "read this device") };
  }
}
