import * as React from 'react';

export default function App() {
  const [text, setText] = React.useState('no goal');

  React.useEffect(() => {
    const handler = (msg: MessageEvent<{ command: string, text: string }>) => {
      switch (msg.data.command) {
        case 'update':
          setText(msg.data.text);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
      <h1>Hello from React inside VS Code Webview:</h1>
      <div>{ text }</div>
    </div>
  );
}
