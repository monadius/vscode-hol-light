import React from 'react';

export function markdownToReact(input: string): React.ReactNode[] {
  const regex = /`+|\n{2,}/g; 
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const addSpan = (start: number, end: number) => {
    const text = input.slice(start, end);
    result.push(
      <span key={result.length}>{text}</span>
    );
  };

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      addSpan(lastIndex, match.index);
    }
    if (match[0][0] === '`') {
        let i = input.indexOf(match[0], regex.lastIndex);
        if (i < 0) {
            i = input.length;
        }
        if (match[0].length >= 3) {
          result.push(<br key={result.length}/>);
        }
        result.push(<code key={result.length} className="!bg-transparent font-bold">{input.slice(regex.lastIndex, i)}</code>)
        regex.lastIndex = i + 1;
    } else if (match[0][0] === '\n') {
        result.push(<br key={result.length}/>)
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    addSpan(lastIndex, input.length);
  }

  return result;
}
