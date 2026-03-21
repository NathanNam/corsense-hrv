import html2canvas from 'html2canvas-pro';

const CHART_IDS = ['chart-stress', 'chart-hr', 'chart-rr', 'chart-rmssd'];

/**
 * Capture the 4 HRV charts as a single combined PNG image (base64).
 * Arranges them in a 2x2 grid layout.
 */
export async function captureCharts(): Promise<string | null> {
  const elements = CHART_IDS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];

  if (elements.length === 0) return null;

  // Capture each chart individually
  const canvases = await Promise.all(
    elements.map((el) =>
      html2canvas(el, {
        backgroundColor: '#ffffff',
        scale: 1,
        logging: false,
        useCORS: true,
      }),
    ),
  );

  // Combine into a 2x2 grid
  const padding = 16;
  const maxW = Math.max(...canvases.map((c) => c.width));
  const maxH = Math.max(...canvases.map((c) => c.height));
  const cols = 2;
  const rows = Math.ceil(canvases.length / cols);

  const combined = document.createElement('canvas');
  combined.width = cols * maxW + (cols + 1) * padding;
  combined.height = rows * maxH + (rows + 1) * padding;

  const ctx = combined.getContext('2d')!;
  ctx.fillStyle = '#f9fafb'; // bg-gray-50
  ctx.fillRect(0, 0, combined.width, combined.height);

  canvases.forEach((canvas, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padding + col * (maxW + padding);
    const y = padding + row * (maxH + padding);
    ctx.drawImage(canvas, x, y);
  });

  // Return as base64 PNG (strip data URL prefix for smaller payload)
  const dataUrl = combined.toDataURL('image/png');
  return dataUrl.split(',')[1]; // base64 only
}
