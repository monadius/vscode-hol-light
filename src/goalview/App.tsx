import { useVSCode } from './use_vscode';
import * as React from 'react';

interface Goal {
    assumptions: [string, string][];
    conclusion: string;
}

export default function App() {
  const vscode = useVSCode();
  const [text, setText] = React.useState('no goal');

  React.useEffect(() => {
    vscode.postMessage({ command: 'refresh' });
  }, []);

  React.useEffect(() => {
    const handler = (msg: MessageEvent<{ command: string }>) => {
      switch (msg.data.command) {
        case 'update':
          const data = (msg.data as unknown) as { text: string, goals: Goal[] };
          setText(data.text);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
      <h1>
        Goals
      </h1>
      <pre style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{text}</pre>
      <div
        style={{
          marginTop: 20,
          padding: '10px 20px',
          background: '#007acc',
          color: 'white',
          borderRadius: 4,
          cursor: 'pointer',
          display: 'inline-block',
          fontWeight: 'bold',
          textAlign: 'center'
        }}
        onClick={() => vscode.postMessage({ command: 'refresh' })}
      >
        Refresh
      </div>
    </div>
  );
}
