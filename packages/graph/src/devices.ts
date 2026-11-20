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
  DEVICE_GRAPH_PERMISSION,
  platformFromOperatingSystem,
  readPhysicalIds,
  type DeviceLookupUnavailable,
  type DeviceMembershipResponse,
  type DeviceSearchResponse,
  type DeviceSearchResult,
} from "@intune-preflight/shared";
import { type GraphClient, isGraphStatus } from "./graphClient.js";

const DEVICE_FIELDS = "id,displayName,operatingSystem,operatingSystemVersion,trustType";
/** Enough to pick from; a name precise enough to matter is in the first page. */
const SEARCH_LIMIT = 15;
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
 * Devices whose display name starts with `query`. A prefix match is what the
 * devices collection filters without advanced-query headers, and device names
 * are usually typed from their start.
 */
export async function searchDevices(client: GraphClient, query: string): Promise<DeviceSearchResponse> {
  const text = query.trim();
  if (text.length < 2) return { devices: [] };
  // OData escapes a quote by doubling it; nothing else in a name can leave the literal.
  const literal = text.replace(/'/g, "''");
  try {
    const page = await client.graphGetObject<{ value?: Record<string, unknown>[] }>(
      `/devices?$filter=startswith(displayName,'${encodeURIComponent(literal)}')&$select=${DEVICE_FIELDS}&$top=${SEARCH_LIMIT}`
    );
    const devices = (page?.value ?? []).map(toResult);
    devices.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
    return { devices };
  } catch (err) {
    return { unavailable: unavailableFrom(err, "search devices") };
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
      },
    };
  } catch (err) {
    return { unavailable: unavailableFrom(err, "read this device") };
  }
}
