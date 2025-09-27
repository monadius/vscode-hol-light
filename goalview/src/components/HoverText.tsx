import React, { useState, useCallback } from "react";
import { requestConstantInfo } from "../utils/info";

const HoverText: React.FC<{ text: string }> = ({ text }) => {
  const [data, setData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  const fetchData = useCallback(async () => {
    // if (data || loading) return; // don’t re-fetch if already loaded
    setLoading(true);
    try {
      // simulate async API call
      const response = await requestConstantInfo(text);
      setData(response);
    } finally {
      setLoading(false);
    }
  }, [text]);

  return (
    <span
      className="relative group cursor-pointer"
      onMouseEnter={() => {
        setVisible(true);
        if (!data && !loading) {
            fetchData();
        }
      }}
      onMouseLeave={() => setVisible(false)}
    >
      {text}
      {visible && (
        <span className="absolute left-0 top-full mt-1 w-max rounded bg-gray-800 px-2 py-1 text-sm text-white">
          {loading ? "Loading…" : data}
        </span>
      )}
    </span>
  );
};

export default HoverText;
