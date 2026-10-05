// PDFの請求書から文字を1行ずつ取り出す。読み取った文字の解釈は lib/invoiceText.ts。
//
// PDFは2種類ある。
//   ・Excelなどから書き出したPDF … 文字のデータが入っているので、そのまま取り出す（正確）
//   ・紙をスキャンしたPDF       … 中身は画像。ブラウザの中でOCR（tesseract.js）にかける
// ページから取り出せた文字がほとんど無ければスキャンとみなす。
//
// スキャンの請求書は表の罫線にOCRが引っぱられて、明細の行（水道・電気）が丸ごと
// 読めなくなる。そこで、ページを画像にしたあと長い横線・縦線を白で消してから読ませる。
// 道頓堀の請求書（2026-09、RICOH の複合機）で、消す前は明細0行・消した後は全行読めた。
//
// どちらのライブラリも重いので、PDFを選んだときに初めて読み込む。
// OCRの日本語データ（数MB）は初回だけネットから取ってきて、以後はブラウザに残る。
import type { PDFPageProxy } from 'pdfjs-dist'

export interface PdfText {
  lines: string[]
  /** OCRで読んだか（＝読み違いがありうる） */
  ocr: boolean
  /** 1ページ目の縮小画像。読み取り結果と見比べるために画面に出す */
  preview: string
}

/** OCRに回すときの拡大率。A4で約1800×2500px。これより粗いと「,」と「.」が崩れやすい */
const OCR_SCALE = 3
/** 文字のデータがこれより少なければスキャンとみなす */
const MIN_TEXT_CHARS = 20
/** 読むページの上限。請求書は1〜2枚なので、間違えて大きなPDFを選んだときの歯止め */
const MAX_PAGES = 5

/** PDFの読み込み準備。ワーカーは pdfjs-dist に同梱のものを使う */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

type PdfPage = PDFPageProxy

/** 文字データを、高さ（y座標）の近いものを1行にまとめて左から並べる */
async function textLines(page: PdfPage): Promise<string[]> {
  const content = await page.getTextContent()
  const items = content.items
    .filter((it): it is Extract<typeof it, { str: string }> => 'str' in it && it.str.trim() !== '')
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || 8 }))
  // PDFの座標は下が0なので、上の行から並べるには y の大きい順
  items.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: { y: number; h: number; parts: { x: number; str: string }[] }[] = []
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.5))
    if (row) row.parts.push(it)
    else rows.push({ y: it.y, h: it.h, parts: [it] })
  }
  return rows.map((r) =>
    r.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str)
      .join(' '),
  )
}

async function renderPage(page: PdfPage, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // intent:'print' にする。既定（画面表示）だと pdf.js は requestAnimationFrame で少しずつ描くので、
  // 読み取り中に別のタブへ切り替えると描画が止まって読み取りが終わらなくなる
  await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise
  return canvas
}

/**
 * 灰色にして、表の罫線を白で消す。
 * 横線はページ幅の6%以上、縦線はページの高さの2%＋40px以上続く黒い画素の並びを線とみなす。
 * 文字の画（「一」や「ー」）はこれより短いので残る。
 */
export function eraseRules(img: ImageData): ImageData {
  const { width: w, height: h, data } = img
  const gray = new Uint8ClampedArray(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
  }
  const dark = (i: number) => gray[i] < 160
  const erase = new Uint8Array(w * h)
  const minH = Math.round(w * 0.06)
  for (let y = 0; y < h; y++) {
    let start = -1
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark(y * w + x)
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        if (x - start >= minH) for (let k = start; k < x; k++) erase[y * w + k] = 1
        start = -1
      }
    }
  }
  const minV = Math.round(h * 0.02) + 40
  for (let x = 0; x < w; x++) {
    let start = -1
    for (let y = 0; y <= h; y++) {
      const on = y < h && dark(y * w + x)
      if (on && start < 0) start = y
      if (!on && start >= 0) {
        if (y - start >= minV) for (let k = start; k < y; k++) erase[k * w + x] = 1
        start = -1
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const v = erase[i] ? 255 : gray[i]
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  return img
}

/** スキャンしたページをOCRにかける。onStatus には進み具合の文言を渡す */
async function ocrPages(pages: PdfPage[], onStatus: (s: string) => void): Promise<string[]> {
  const { createWorker, PSM } = await import('tesseract.js')
  onStatus('文字の読み取りを準備しています（初回は日本語データの取得に少しかかります）…')
  const worker = await createWorker('jpn', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onStatus(`文字を読み取っています… ${Math.round(m.progress * 100)}%`)
    },
  })
  try {
    const lines: string[] = []
    for (const page of pages) {
      const canvas = await renderPage(page, OCR_SCALE)
      const ctx = canvas.getContext('2d')!
      ctx.putImageData(eraseRules(ctx.getImageData(0, 0, canvas.width, canvas.height)), 0, 0)
      // 表の明細は「1つのかたまり」として読ませたほうが行が崩れない
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
      })
      const { data } = await worker.recognize(canvas)
      lines.push(...data.text.split('\n'))
      // 宛名（〇〇御中）は左上に離れて置かれていて、1かたまりの読み方だと落ちることがある。
      // 見つからなかったときだけ、段組みを見る読み方でもう一度読んで宛名の行だけ足す
      if (!lines.some((l) => /御\s*中|様/.test(l))) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN })
        const again = await worker.recognize(canvas)
        lines.push(...again.data.text.split('\n').filter((l) => /御\s*中/.test(l)))
      }
    }
    return lines
  } finally {
    await worker.terminate()
  }
}

export async function readPdfText(file: File, onStatus: (s: string) => void): Promise<PdfText> {
  onStatus('PDFを開いています…')
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  try {
    const pages: PdfPage[] = []
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) pages.push(await doc.getPage(i))

    const preview = (await renderPage(pages[0], 1.2)).toDataURL('image/jpeg', 0.75)

    const text: string[] = []
    for (const p of pages) text.push(...(await textLines(p)))
    if (text.join('').replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
      return { lines: text, ocr: false, preview }
    }
    return { lines: await ocrPages(pages, onStatus), ocr: true, preview }
  } finally {
    void task.destroy()
  }
}
