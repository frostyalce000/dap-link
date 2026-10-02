"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";

/** The public URL of a campaign, with copy and open buttons. */
export function ShareLink({ url, live }: { url: string; live: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address is selectable in the field.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url.replace(/^https?:\/\//, "")}
        aria-label="Your public link"
        onFocus={(event) => event.target.select()}
        className="h-11 min-w-0 flex-1 basis-56 rounded-full border border-line-strong bg-paper px-4 font-mono text-sm outline-none"
      />
      <button type="button" onClick={copy} className={primaryButtonClass}>
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
      </button>
      {live && (
        <a href={url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
          <ExternalLink className="size-4" aria-hidden="true" />
          Open
        </a>
      )}
    </div>
  );
}
