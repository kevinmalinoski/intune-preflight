import { createContext } from "react";

/**
 * True while the app is showing the sample tenant. Its ids are made up, so an
 * admin-center link there would lead nowhere; the mark is drawn inactive, with
 * a note saying what it does against a real tenant.
 */
export const PortalDemoContext = createContext(false);

/**
 * Admin-center addresses for the policies in the current simulation, by policy
 * name. By name because that is all a baseline row carries about its source; a
 * name two policies share is left out, since it could point at either.
 */
export const PolicyLinksContext = createContext<ReadonlyMap<string, string>>(new Map());
