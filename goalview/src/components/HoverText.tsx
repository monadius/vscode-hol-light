import React, { useState, useCallback } from "react";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react";
import { requestConstantInfo } from "../utils/info";
import { markdownToReact } from "../utils/markdown";

const HoverText: React.FC<{ text: string }> = ({ text }) => {
  const [data, setData] = useState<React.ReactNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await requestConstantInfo(text);
      setData(response ? markdownToReact(response) : null);
    } finally {
      setLoading(false);
    }
  }, [text]);

  const {refs, floatingStyles } = useFloating({
    open: visible && data !== null,
    onOpenChange: setVisible,
    middleware: [offset(1), flip(), shift()],
    whileElementsMounted: autoUpdate,
    placement: 'top',
  });

  return (
    <span
      ref={refs.setReference}
      className="cursor-pointer"
      onMouseEnter={() => {
        setVisible(true);
        if (data === null && !loading) {
            fetchData();
        }
      }}
      onMouseLeave={() => setVisible(false)}
    >
      {text}
      {visible && data !== null && (
          <span
            ref={refs.setFloating}
            style={floatingStyles}
            className="tooltip"
          >
            {data}
          </span>
      )}
    </span>
  );
};

export default HoverText;
