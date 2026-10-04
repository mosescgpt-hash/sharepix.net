import type { ReactNode } from 'react';
import { PT, type SignElement, type SignLayout } from '@/lib/signKit/layout';
import { qrRuns } from '@/lib/signKit/qr';

/**
 * An on-screen picture of a sign, drawn from the same layout the PDF is.
 *
 * Only a preview: the browser's Helvetica stand-in may set a hair wider or
 * narrower than the PDF's, so the downloaded file is the one to proof.
 */
export default function SignPreview({ layout, title }: { layout: SignLayout; title: string }) {
  return (
    <svg
      viewBox={`0 0 ${layout.pageWidth} ${layout.pageHeight}`}
      className="h-full w-full"
      role="img"
      aria-label={title}
    >
      {layout.elements.map((el, i) => (
        <PreviewElement key={i} el={el} />
      ))}
    </svg>
  );
}

function PreviewElement({ el }: { el: SignElement }): ReactNode {
  switch (el.type) {
    case 'rect':
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={el.fill} />;
    case 'roundedRect':
      return (
        <rect
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          rx={el.r}
          fill={el.fill ?? 'none'}
          stroke={el.stroke ?? 'none'}
          strokeWidth={el.strokeWidth}
        />
      );
    case 'circle':
      return <circle cx={el.x} cy={el.y} r={el.r} fill={el.fill} />;
    case 'text':
      return (
        <text
          x={el.x}
          y={el.y}
          fontSize={el.sizePt * PT}
          fontWeight={el.bold ? 700 : 400}
          fontFamily="Helvetica, Arial, sans-serif"
          fill={el.color}
          textAnchor={el.align === 'center' ? 'middle' : 'start'}
          dominantBaseline="hanging"
          letterSpacing={el.charSpace || undefined}
        >
          {el.text}
        </text>
      );
    case 'qr': {
      const m = el.size / el.matrix.length;
      const d = qrRuns(el.matrix)
        .map((r) => `M${el.x + r.col * m} ${el.y + r.row * m}h${r.length * m}v${m}h${-r.length * m}z`)
        .join('');
      return <path d={d} fill={el.color} shapeRendering="crispEdges" />;
    }
    case 'line':
      return <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth={el.widthPt * PT} />;
    case 'logo': {
      const u = el.height / 34;
      return (
        <g transform={`translate(${el.x} ${el.y}) scale(${u})`}>
          <rect x="12" y="1" width="12" height="7" rx="2.5" fill={el.body} />
          <rect x="1" y="5" width="38" height="28" rx="7" fill={el.body} />
          <rect x="6" y="11" width="12" height="12" rx="2" fill={el.detail} />
          <rect x="8" y="13" width="3.2" height="3.2" fill={el.body} />
          <rect x="13" y="13" width="2.2" height="2.2" fill={el.body} />
          <rect x="8" y="18" width="2.2" height="2.2" fill={el.body} />
          <rect x="12" y="17" width="3.2" height="3.2" fill={el.body} />
          <circle cx="28" cy="19" r="8" stroke={el.detail} strokeWidth="2.4" fill="none" />
          <path d="M26 15.5l6 3.5-6 3.5v-7z" fill={el.play} />
        </g>
      );
    }
    case 'nfcIcon': {
      const cy = el.y + el.size / 2;
      const cx = el.x + el.size * 0.12;
      const sweep = Math.PI / 2.4;
      const arcs = [0.32, 0.56, 0.8].map((f) => {
        const r = f * el.size;
        const x1 = cx + r * Math.cos(-sweep);
        const y1 = cy + r * Math.sin(-sweep);
        const y2 = cy + r * Math.sin(sweep);
        return `M${x1} ${y1}A${r} ${r} 0 0 1 ${x1} ${y2}`;
      });
      return (
        <g>
          <circle cx={cx} cy={cy} r={el.size * 0.09} fill={el.color} />
          <path d={arcs.join('')} fill="none" stroke={el.color} strokeWidth={el.strokeWidth} strokeLinecap="round" />
        </g>
      );
    }
  }
}
