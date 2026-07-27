import { describe, expect, it } from "vitest";
import { msLearnCspUrl, splitCspRef } from "./cspDocs.js";

const MDM = "https://learn.microsoft.com/windows/client-management/mdm/";

describe("msLearnCspUrl", () => {
  it("maps Policy CSP paths to the area page with a setting anchor", () => {
    expect(msLearnCspUrl("./Device/Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring")).toBe(
      `${MDM}policy-csp-defender#allowrealtimemonitoring`
    );
  });

  it("maps ADMX-backed areas with underscore -> hyphen", () => {
    expect(msLearnCspUrl("./Device/Vendor/MSFT/Policy/Config/ADMX_WindowsExplorer/SomeSetting")).toBe(
      `${MDM}policy-csp-admx-windowsexplorer#somesetting`
    );
  });

  it("maps non-policy CSPs to <csp>-csp with a leaf anchor", () => {
    expect(msLearnCspUrl("./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption")).toBe(
      `${MDM}bitlocker-csp#requiredeviceencryption`
    );
  });

  it("handles paths without a Device/User scope segment", () => {
    expect(msLearnCspUrl("./Vendor/MSFT/Firewall/MdmStore/Global/EnablePacketQueue")).toBe(
      `${MDM}firewall-csp#enablepacketqueue`
    );
  });

  it("returns undefined for non-CSP references", () => {
    expect(msLearnCspUrl("windowsUpdateForBusinessConfiguration:deferFeatureUpdatesPeriodInDays")).toBeUndefined();
    expect(msLearnCspUrl("./Device/Vendor/OtherCorp/Thing/Setting")).toBeUndefined();
    expect(msLearnCspUrl(undefined)).toBeUndefined();
  });

  it("returns undefined for third-party ingested ADMX (tilde category paths)", () => {
    expect(
      msLearnCspUrl("./Device/Vendor/MSFT/Policy/Config/chromeintunev141~Policy~googlechrome/HomepageLocation")
    ).toBeUndefined();
    expect(
      msLearnCspUrl("./Device/Vendor/MSFT/Policy/Config/microsoft-edgev86~policy~microsoft-edge/SmartScreenEnabled")
    ).toBeUndefined();
  });

  it("returns undefined for CSPs with no MDM reference page (EPM)", () => {
    expect(msLearnCspUrl("./Device/Vendor/MSFT/PolicyPrivilegeManagement/ElevationClientSettings")).toBeUndefined();
  });

  it("routes wholesale-deprecated legacy CSPs to their modern Policy CSP area", () => {
    // The standalone DeviceLock CSP page is deprecated ("use Policy CSP");
    // its node names live on under policy-csp-devicelock (verified anchors).
    expect(msLearnCspUrl("./Device/Vendor/MSFT/DeviceLock/MinDevicePasswordLength")).toBe(
      `${MDM}policy-csp-devicelock#mindevicepasswordlength`
    );
  });
});

describe("splitCspRef", () => {
  it("dims the boilerplate prefix of a Policy CSP path", () => {
    expect(splitCspRef("./Device/Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring")).toEqual({
      prefix: "./Device/Vendor/MSFT/Policy/Config/",
      tail: "Defender/AllowRealtimeMonitoring",
    });
  });

  it("keeps the CSP name in the tail for non-policy CSPs", () => {
    expect(splitCspRef("./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption")).toEqual({
      prefix: "./Device/Vendor/MSFT/",
      tail: "BitLocker/RequireDeviceEncryption",
    });
  });

  it("splits namespaced legacy ids at the last colon", () => {
    expect(splitCspRef("windowsUpdateForBusinessConfiguration:deferFeatureUpdatesPeriodInDays")).toEqual({
      prefix: "windowsUpdateForBusinessConfiguration:",
      tail: "deferFeatureUpdatesPeriodInDays",
    });
  });

  it("passes plain ids through untouched", () => {
    expect(splitCspRef("device_vendor_msft_bitlocker_requiredeviceencryption")).toEqual({
      prefix: "",
      tail: "device_vendor_msft_bitlocker_requiredeviceencryption",
    });
  });
});
