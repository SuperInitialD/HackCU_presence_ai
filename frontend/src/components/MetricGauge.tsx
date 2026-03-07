import React from 'react';

interface MetricGaugeProps {
  label: string;
  value: number; // 0-100
  type?: 'gauge' | 'bar';
  invert?: boolean; // for stress: high = bad (red)
  color?: string;
}

function getColor(value: number, invert: boolean): string {
  const v = invert ? 100 - value : value;
  if (v >= 70) return '#22c55e';
  if (v >= 40) return '#eab308';
  return '#ef4444';
}

const MetricGauge: React.FC<MetricGaugeProps> = ({ label, value, type = 'gauge', invert = false, color }) => {
  const resolvedColor = color || getColor(value, invert);
  const displayValue = Math.round(value);

  if (type === 'bar') {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}>
          <span style={{ fontSize: 12, color: '#8888aa', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
          </span>
          <span style={{ fontSize: 13, color: resolvedColor, fontWeight: 700 }}>
            {displayValue}%
          </span>
        </div>
        <div style={{
          width: '100%',
          height: 6,
          background: '#1c1c28',
          borderRadius: 3,
          overflow: 'hidden',
          border: '1px solid #2a2a3e',
        }}>
          <div
            style={{
              width: `${value}%`,
              height: '100%',
              background: resolvedColor,
              borderRadius: 3,
              transition: 'width 0.5s ease, background 0.3s ease',
              boxShadow: `0 0 8px ${resolvedColor}66`,
            }}
          />
        </div>
      </div>
    );
  }

  // Circular gauge
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - value / 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: 76, height: 76 }}>
        <svg width="76" height="76" viewBox="0 0 76 76">
          <circle
            cx="38" cy="38" r={radius}
            fill="none"
            stroke="#1c1c28"
            strokeWidth="6"
          />
          <circle
            cx="38" cy="38" r={radius}
            fill="none"
            stroke={resolvedColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 38 38)"
            style={{
              transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease',
              filter: `drop-shadow(0 0 6px ${resolvedColor}88)`,
            }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: resolvedColor, lineHeight: 1 }}>
            {displayValue}
          </span>
        </div>
      </div>
      <span style={{ fontSize: 11, color: '#8888aa', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>
        {label}
      </span>
    </div>
  );
};

export default MetricGauge;
