import { useContext } from "react";
import { PolicyLinksContext } from "./portalDemo.ts";

/**
 * A source policy's name in the baseline. Where the policy has a page in the
 * admin center the name itself is the link -- nothing else happens when a name
 * here is clicked, so unlike the diagram and the lists it needs no separate
 * mark. Otherwise it is the plain text it always was.
 */
export function PolicyName({ name }: { name: string }) {
  const url = useContext(PolicyLinksContext).get(name);
  if (!url) return <>{name}</>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open in Intune ↗"
      className="underline decoration-slate-600 decoration-dotted underline-offset-2 transition-colors hover:text-sky-300 hover:decoration-sky-400"
      // Overlap rows expand on click; following a link is not that.
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </a>
  );
}
