import React, { useState } from 'react';

export default function HoverMenuItem({ text, onClick, color }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        padding: '8px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        color: color || '#e3e3e8',
        background: hover ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        transition: 'background 0.2s',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {text}
    </div>
  );
}
