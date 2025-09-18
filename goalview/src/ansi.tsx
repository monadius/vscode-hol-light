import * as React from 'react';

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ansiToTailwind: Record<string, string> = {
  "30": "text-black",
  "31": "text-red-500",
  "32": "text-green-500",
  "33": "text-yellow-500",
  "34": "text-blue-500",
  "35": "text-purple-500",
  "36": "text-cyan-500",
  "37": "text-white",

  "90": "text-gray-500", // bright black
  "91": "text-red-400",  // bright red
  "92": "text-green-400",
  "93": "text-yellow-400",
  "94": "text-blue-400",
  "95": "text-purple-400",
  "96": "text-cyan-400",
  "97": "text-gray-100", // bright white

    // background colors
  "40": "bg-black",
  "41": "bg-red-500",
  "42": "bg-green-500",
  "43": "bg-yellow-500",
  "44": "bg-blue-500",
  "45": "bg-purple-500",
  "46": "bg-cyan-500",
  "47": "bg-white",

  "100": "bg-gray-500",
  "101": "bg-red-400",
  "102": "bg-green-400",
  "103": "bg-yellow-400",
  "104": "bg-blue-400",
  "105": "bg-purple-400",
  "106": "bg-cyan-400",
  "107": "bg-gray-100",
};

export function ansiToReact(input: string): React.ReactNode[] {
  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[(\d+(;\d+)*)m/g; 
  // matches sequences like \x1b[1;31m (bold + red)
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let activeClasses: string[] = [];

  const addSpan = (start: number, end: number) => result.push(
    <span key={result.length} className={activeClasses.join(" ")}>
     {input.slice(start, end)}
    </span>
  );

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      addSpan(lastIndex, match.index);
    }

    const codes = match[1].split(";");
    for (const code of codes) {
      if (code === "0") {
        activeClasses = []; // reset all
      } else if (code === "1") {
        activeClasses.push("font-bold"); // bold
      } else if (ansiToTailwind[code]) {
        // remove any previous text-*/bg-* before adding new
        if (code.startsWith("3") || code.startsWith("9")) {
          activeClasses = activeClasses.filter(c => !c.startsWith("text-"));
        }
        if (code.startsWith("4") || code.startsWith("10")) {
          activeClasses = activeClasses.filter(c => !c.startsWith("bg-"));
        }
        activeClasses.push(ansiToTailwind[code]);
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    addSpan(lastIndex, input.length);
  }

  return result;
}
