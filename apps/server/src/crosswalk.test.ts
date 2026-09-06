import { describe, expect, it } from "vitest";
import { crosswalkTemplateSetting, normalizeCspNode } from "./crosswalk.js";

describe("normalizeCspNode", () => {
  it("normalizes Settings Catalog / OMA-URI paths to a shared node", () => {
    // A Settings Catalog cspPath and an OMA-URI targeting the same CSP collapse.
    expect(normalizeCspNode("./Device/Vendor/MSFT/Policy/Config/Accounts/AllowMicrosoftAccountConnection")).toBe(
      "accounts/allowmicrosoftaccountconnection"
    );
    expect(normalizeCspNode("./User/Vendor/MSFT/Policy/Config/Accounts/AllowMicrosoftAccountConnection")).toBe(
      "accounts/allowmicrosoftaccountconnection"
    );
    // Non-Policy-CSP path keeps its area.
    expect(normalizeCspNode("./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption")).toBe(
      "bitlocker/requiredeviceencryption"
    );
  });

  it("returns undefined for non-path inputs", () => {
    expect(normalizeCspNode(undefined)).toBeUndefined();
    expect(normalizeCspNode("microsoftAccountBlocked")).toBeUndefined();
  });
});

describe("crosswalkTemplateSetting", () => {
  it("maps a windows10GeneralConfiguration property to its CSP node + canonical value", () => {
    const r = crosswalkTemplateSetting("#microsoft.graph.windows10GeneralConfiguration", "microsoftAccountBlocked", "true");
    expect(r?.cspNode).toBe("accounts/allowmicrosoftaccountconnection");
    expect(r?.cspNodeValue).toBe("Block"); // true -> Block, matching the Settings Catalog value space
  });

  it("returns undefined for properties/types not in the crosswalk", () => {
    expect(crosswalkTemplateSetting("#microsoft.graph.windows10GeneralConfiguration", "someUnmappedProp", "true")).toBeUndefined();
    expect(crosswalkTemplateSetting("#microsoft.graph.windowsUpdateForBusinessConfiguration", "microsoftAccountBlocked", "true")).toBeUndefined();
  });
});
