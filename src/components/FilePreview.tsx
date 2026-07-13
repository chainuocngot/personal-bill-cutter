import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { ChevronLeft, ChevronRight, Crop, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import clsx from "clsx"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import ActionPanel from "@/components/ActionPanel"

interface FilePreviewProps {
  files: File[]
  scale?: number
  selectedFileIndex: number
  /** Được gọi mỗi khi crop thành công, trả về danh sách ảnh (dataURL PNG) cho từng file */
  onCrop?: (results: { file: File; dataUrl: string }[]) => void
}

const MIN_SELECTION_SIZE = 6

// Scale dùng riêng để RENDER LẠI pdf ở độ phân giải cao khi export ảnh crop.
// Tách biệt hoàn toàn với `scale` (dùng để hiển thị on-screen, thường thấp
// để mượt/nhẹ) -> ảnh crop luôn nét bất kể `scale` hiển thị là bao nhiêu.
const EXPORT_SCALE = 4

const CONTAINER_WIDTH = 794
const CONTAINER_HEIGHT = 1123 // A4

// Cấu hình tờ A4 xuất ra để in: khổ dọc, hỗ trợ nhiều layout lưới khác nhau
// (2/4/6/8 ảnh/tờ), mỗi ảnh được canh giữa trong ô của nó (giữ nguyên tỉ lệ,
// không méo ảnh).
const A4_DPI = 300
const A4_WIDTH_PX = Math.round(8.27 * A4_DPI) // ~2481px
const A4_HEIGHT_PX = Math.round(11.69 * A4_DPI) // ~3507px
const CELL_PADDING_PX = Math.round(0.3 * A4_DPI) // lề trong mỗi ô

export type LayoutOption = 2 | 4 | 6 | 8

interface GridConfig {
  cols: number
  rows: number
}

// Số ảnh/tờ -> số cột x số hàng. Khổ dọc nên ưu tiên tối đa 2 cột.
const LAYOUT_GRID: Record<LayoutOption, GridConfig> = {
  2: { cols: 1, rows: 2 },
  4: { cols: 2, rows: 2 },
  6: { cols: 2, rows: 3 },
  8: { cols: 2, rows: 4 },
}

interface SelectionRatio {
  x: number
  y: number
  width: number
  height: number
}

export type FileKind = "pdf" | "image"

const getFileKind = (file: File): FileKind => {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return "pdf"
  }
  return "image"
}

// eslint-disable-next-line react-refresh/only-export-components
export const FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  image: "ảnh",
}

const EMPTY_SELECTION = { x: 0, y: 0, width: 0, height: 0 }

type SelectionBox = typeof EMPTY_SELECTION

export default function FilePreview({
  files,
  scale = 1.2,
  selectedFileIndex,
  onCrop,
}: FilePreviewProps) {
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Mỗi loại file (PDF / ảnh) có VÙNG CHỌN và KẾT QUẢ CROP riêng biệt, độc
  // lập với nhau — vì kích thước/bố cục trang PDF và ảnh thường khác nhau
  // nên không thể dùng chung 1 vùng chọn. Khi trong 1 lượt xử lý có cả 2
  // loại file, phải crop đủ CẢ HAI loại thì mới ghép được tờ A4 (xem
  // `isCropComplete` bên dưới).
  const [selectionsByKind, setSelectionsByKind] = useState<
    Record<FileKind, SelectionBox>
  >({
    pdf: EMPTY_SELECTION,
    image: EMPTY_SELECTION,
  })

  const [isDragging, setIsDragging] = useState(false)
  const [isCropping, setIsCropping] = useState(false)
  const [isBuildingSheets, setIsBuildingSheets] = useState(false)
  // Layout tờ A4: số ảnh/tờ do người dùng chọn (2, 4, 6 hoặc 8)
  const [layout, setLayout] = useState<LayoutOption>(4)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [croppedByKind, setCroppedByKind] = useState<
    Record<FileKind, { file: File; dataUrl: string }[]>
  >({
    pdf: [],
    image: [],
  })

  const startPoint = useRef({
    x: 0,
    y: 0,
  })

  const currentFile = files[selectedFileIndex] as File | undefined
  const currentFileKind: FileKind = currentFile
    ? getFileKind(currentFile)
    : "pdf"

  // Nút crop chỉ áp dụng vùng chọn cho các file CÙNG LOẠI với file đang xem
  // (đều là PDF hoặc đều là ảnh) — vì mỗi loại có vùng chọn riêng.
  const targetFiles = files.filter((f) => getFileKind(f) === currentFileKind)
  const pdfFiles = files.filter((f) => getFileKind(f) === "pdf")
  const imageFiles = files.filter((f) => getFileKind(f) === "image")

  const selection = selectionsByKind[currentFileKind]

  // Gộp kết quả crop của cả 2 loại (PDF + ảnh), giữ đúng thứ tự file gốc,
  // để ghép chung vào cùng 1 tờ A4.
  const croppedImages = files
    .map((f) => croppedByKind[getFileKind(f)].find((r) => r.file === f))
    .filter((r): r is { file: File; dataUrl: string } => !!r)

  const hasSelection =
    selection.width >= MIN_SELECTION_SIZE &&
    selection.height >= MIN_SELECTION_SIZE

  const clearSelection = useCallback(
    (kind: FileKind = currentFileKind) => {
      setSelectionsByKind((prev) => ({ ...prev, [kind]: EMPTY_SELECTION }))
      setCroppedByKind((prev) => ({ ...prev, [kind]: [] }))
    },
    [currentFileKind],
  )

  // Với file ảnh (không phải PDF), tạo object URL để hiển thị qua thẻ <img>.
  // react-pdf's Document/Page chỉ dùng cho PDF nên không áp dụng được ở đây.
  useEffect(() => {
    if (!currentFile || currentFileKind !== "image") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImageUrl(null)
      return
    }

    const url = URL.createObjectURL(currentFile)
    setImageUrl(url)
    setNumPages(1)
    setPage(1)
    clearSelection()

    return () => URL.revokeObjectURL(url)
  }, [clearSelection, currentFile, currentFileKind])

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    startPoint.current = { x, y }

    setSelectionsByKind((prev) => ({
      ...prev,
      [currentFileKind]: { x, y, width: 0, height: 0 },
    }))

    setCroppedByKind((prev) => ({ ...prev, [currentFileKind]: [] }))
    setIsDragging(true)
  }

  const handleWindowMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()

      const rawX = e.clientX - rect.left
      const rawY = e.clientY - rect.top

      const currentX = Math.min(Math.max(rawX, 0), rect.width)
      const currentY = Math.min(Math.max(rawY, 0), rect.height)

      const x = Math.min(startPoint.current.x, currentX)
      const y = Math.min(startPoint.current.y, currentY)

      const width = Math.abs(currentX - startPoint.current.x)
      const height = Math.abs(currentY - startPoint.current.y)

      setSelectionsByKind((prev) => ({
        ...prev,
        [currentFileKind]: { x, y, width, height },
      }))
    },
    [currentFileKind],
  )

  const handleWindowMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    window.addEventListener("mousemove", handleWindowMouseMove)
    window.addEventListener("mouseup", handleWindowMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove)
      window.removeEventListener("mouseup", handleWindowMouseUp)
    }
  }, [isDragging, handleWindowMouseMove, handleWindowMouseUp])

  /**
   * Quy đổi selection (toạ độ CSS px trong containerRef) CỦA LOẠI FILE ĐANG
   * XEM sang TỈ LỆ (0 -> 1) so với chính phần tử hiển thị trang/ảnh hiện tại
   * (canvas với PDF, img với file ảnh). Dùng tỉ lệ thay vì toạ độ tuyệt đối
   * giúp cùng một vùng chọn áp dụng đúng vị trí tương ứng cho các file khác
   * CÙNG LOẠI, kể cả khi kích thước trang/ảnh của chúng khác nhau.
   */
  const getSelectionRatio = (): SelectionRatio | null => {
    if (!containerRef.current) return null

    const previewEl: HTMLElement | null =
      currentFileKind === "pdf"
        ? containerRef.current.querySelector("canvas")
        : containerRef.current.querySelector('img[data-role="preview-image"]')

    if (!previewEl) return null

    const containerRect = containerRef.current.getBoundingClientRect()
    const previewRect = previewEl.getBoundingClientRect()

    const offsetX = previewRect.left - containerRect.left
    const offsetY = previewRect.top - containerRect.top

    return {
      x: (selection.x - offsetX) / previewRect.width,
      y: (selection.y - offsetY) / previewRect.height,
      width: selection.width / previewRect.width,
      height: selection.height / previewRect.height,
    }
  }

  /**
   * Render lại 1 trang của 1 file PDF bất kỳ ở EXPORT_SCALE (độ phân giải
   * cao) để lấy nguồn crop sắc nét, thay vì crop trực tiếp từ canvas đang
   * hiển thị trên màn hình (vốn chỉ render ở `scale` thấp nên phóng to sẽ vỡ nét).
   */
  const renderPdfPageToCanvas = async (
    file: File,
    pageNumber: number,
  ): Promise<HTMLCanvasElement | null> => {
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
    const safePage = Math.min(Math.max(pageNumber, 1), pdf.numPages)
    const pdfPage = await pdf.getPage(safePage)

    const viewport = pdfPage.getViewport({ scale: EXPORT_SCALE })

    const canvas = document.createElement("canvas")
    canvas.width = viewport.width
    canvas.height = viewport.height

    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise

    return canvas
  }

  /**
   * Đưa 1 file ảnh (png/jpg/jpeg) vào canvas ở đúng độ phân giải gốc của nó
   * để crop cho sắc nét (không cần scale thêm như PDF).
   */
  const renderImageFileToCanvas = async (
    file: File,
  ): Promise<HTMLCanvasElement | null> => {
    const url = URL.createObjectURL(file)
    try {
      const img = await loadImage(url)

      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      const ctx = canvas.getContext("2d")
      if (!ctx) return null

      ctx.drawImage(img, 0, 0)

      return canvas
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const renderFileToCanvas = async (
    file: File,
    pageNumber: number,
  ): Promise<HTMLCanvasElement | null> => {
    return getFileKind(file) === "pdf"
      ? renderPdfPageToCanvas(file, pageNumber)
      : renderImageFileToCanvas(file)
  }

  const cropCanvasByRatio = (
    sourceCanvas: HTMLCanvasElement,
    ratio: SelectionRatio,
  ): string => {
    const sx = ratio.x * sourceCanvas.width
    const sy = ratio.y * sourceCanvas.height
    const sWidth = ratio.width * sourceCanvas.width
    const sHeight = ratio.height * sourceCanvas.height

    const cropCanvas = document.createElement("canvas")
    cropCanvas.width = sWidth
    cropCanvas.height = sHeight

    const ctx = cropCanvas.getContext("2d")
    if (!ctx) return ""

    ctx.drawImage(sourceCanvas, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight)

    return cropCanvas.toDataURL("image/png")
  }

  // Crop CÙNG MỘT vùng chọn (của loại file đang xem) cho các file CÙNG LOẠI
  // (đều là PDF hoặc đều là ảnh), ở cùng số trang `page` hiện tại (chỉ áp
  // dụng cho PDF, tự động clamp nếu file đó ít trang hơn). Kết quả được lưu
  // riêng theo loại, gộp với kết quả (nếu có) của loại còn lại khi build A4.
  const handleCropAll = async () => {
    if (!hasSelection) return
    const ratio = getSelectionRatio()
    if (!ratio) return

    const kind = currentFileKind

    setIsCropping(true)
    try {
      const results = await Promise.all(
        targetFiles.map(async (file) => {
          const sourceCanvas = await renderFileToCanvas(file, page)
          if (!sourceCanvas) return null
          const dataUrl = cropCanvasByRatio(sourceCanvas, ratio)
          return { file, dataUrl }
        }),
      )

      const validResults = results.filter(
        (r): r is { file: File; dataUrl: string } => !!r && !!r.dataUrl,
      )

      setCroppedByKind((prev) => {
        const next = { ...prev, [kind]: validResults }
        onCrop?.([...next.pdf, ...next.image])
        return next
      })
    } finally {
      setIsCropping(false)
    }
  }

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  /**
   * Xoay 1 ảnh (dataURL) 90 độ theo chiều kim đồng hồ, trả về dataURL mới.
   * Chiều rộng/cao được hoán đổi cho nhau (canvas.width = img.height và
   * ngược lại) vì ảnh xoay 90/270 độ sẽ đổi hướng ngang <-> dọc.
   */
  const rotateImageDataUrl90 = async (dataUrl: string): Promise<string> => {
    const img = await loadImage(dataUrl)

    const canvas = document.createElement("canvas")
    canvas.width = img.height
    canvas.height = img.width

    const ctx = canvas.getContext("2d")
    if (!ctx) return dataUrl

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((90 * Math.PI) / 180)
    ctx.drawImage(img, -img.width / 2, -img.height / 2)

    return canvas.toDataURL("image/png")
  }

  // Xoay TẤT CẢ ảnh đã crop (cả 2 loại pdf + image) cùng lúc 90 độ, cập nhật
  // lại luôn dataURL đã lưu trong `croppedByKind` -> ảnh xoay sẽ được dùng
  // khi ghép tờ A4.
  const [isRotatingAll, setIsRotatingAll] = useState(false)

  const handleRotateAllCropped = async () => {
    if (croppedImages.length === 0) return

    setIsRotatingAll(true)
    try {
      const [rotatedPdf, rotatedImage] = await Promise.all([
        Promise.all(
          croppedByKind.pdf.map(async (r) => ({
            ...r,
            dataUrl: await rotateImageDataUrl90(r.dataUrl),
          })),
        ),
        Promise.all(
          croppedByKind.image.map(async (r) => ({
            ...r,
            dataUrl: await rotateImageDataUrl90(r.dataUrl),
          })),
        ),
      ])

      const next = { pdf: rotatedPdf, image: rotatedImage }
      setCroppedByKind(next)
      onCrop?.([...next.pdf, ...next.image])
    } finally {
      setIsRotatingAll(false)
    }
  }

  /**
   * Ghép các ảnh crop thành các tờ A4 dọc, mỗi tờ chứa tối đa
   * grid.cols x grid.rows ảnh (theo layout người dùng chọn: 2/4/6/8).
   * Mỗi ảnh được scale để vừa khít trong ô của nó (giữ nguyên tỉ lệ, không
   * méo) và canh giữa cả theo chiều ngang lẫn chiều dọc trong ô. Nếu số ảnh
   * không chia hết cho số ô/tờ thì tờ cuối sẽ có ô trống.
   */
  const buildA4Sheets = async (
    images: { file: File; dataUrl: string }[],
    grid: GridConfig,
  ): Promise<string[]> => {
    const { cols, rows } = grid
    const perSheet = cols * rows
    const cellWidth = A4_WIDTH_PX / cols
    const cellHeight = A4_HEIGHT_PX / rows

    const sheets: string[] = []

    for (let i = 0; i < images.length; i += perSheet) {
      const chunk = images.slice(i, i + perSheet)

      const canvas = document.createElement("canvas")
      canvas.width = A4_WIDTH_PX
      canvas.height = A4_HEIGHT_PX

      const ctx = canvas.getContext("2d")
      if (!ctx) continue

      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      for (let idx = 0; idx < chunk.length; idx++) {
        const img = await loadImage(chunk[idx].dataUrl)

        const col = idx % cols
        const row = Math.floor(idx / cols)

        const cellX = col * cellWidth
        const cellY = row * cellHeight

        const maxW = cellWidth - CELL_PADDING_PX * 2
        const maxH = cellHeight - CELL_PADDING_PX * 2

        // "contain": vừa khít ô, giữ tỉ lệ, có thể phóng to hoặc thu nhỏ
        const fitScale = Math.min(maxW / img.width, maxH / img.height)
        const drawW = img.width * fitScale
        const drawH = img.height * fitScale

        const drawX = cellX + (cellWidth - drawW) / 2
        const drawY = cellY + (cellHeight - drawH) / 2

        ctx.drawImage(img, drawX, drawY, drawW, drawH)
      }

      // Đường kẻ mảnh chia lưới theo đúng số cột/hàng của layout, tiện cắt
      // sau khi in
      ctx.strokeStyle = "#dddddd"
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let c = 1; c < cols; c++) {
        const x = c * cellWidth
        ctx.moveTo(x, 0)
        ctx.lineTo(x, A4_HEIGHT_PX)
      }
      for (let r = 1; r < rows; r++) {
        const y = r * cellHeight
        ctx.moveTo(0, y)
        ctx.lineTo(A4_WIDTH_PX, y)
      }
      ctx.stroke()

      sheets.push(canvas.toDataURL("image/png"))
    }

    return sheets
  }

  // Đủ điều kiện tải về khi: mỗi loại file (PDF, ảnh) CÓ MẶT trong danh sách
  // đều đã được crop đủ 100% file của loại đó. Nếu process có cả PDF lẫn
  // ảnh, bắt buộc phải set vùng chọn + crop cho CẢ HAI loại mới tạo được
  // ảnh A4 gộp chung.
  const isPdfDone =
    pdfFiles.length === 0 || croppedByKind.pdf.length === pdfFiles.length
  const isImageDone =
    imageFiles.length === 0 || croppedByKind.image.length === imageFiles.length
  const isCropComplete = files.length > 0 && isPdfDone && isImageDone

  const handleDownloadSheets = async () => {
    if (!isCropComplete) return

    setIsBuildingSheets(true)
    try {
      const sheets = await buildA4Sheets(croppedImages, LAYOUT_GRID[layout])
      sheets.forEach((dataUrl, i) => {
        const link = document.createElement("a")
        link.href = dataUrl
        link.download = `crop-sheet-A4-${i + 1}.png`
        link.click()
      })
    } finally {
      setIsBuildingSheets(false)
    }
  }

  if (!files?.length) {
    return (
      <div className="flex h-175 items-center justify-center border bg-muted/20 col-span-2">
        <p className="text-muted-foreground">Kéo thả tài liệu để xem trước</p>
      </div>
    )
  }

  const isShowDownloadCol = isCropping || croppedImages.length > 0

  return (
    <>
      <Card
        className={clsx("pt-0", {
          "col-span-2": !isShowDownloadCol,
        })}
      >
        <div className="flex items-center justify-between border-b p-4">
          <div className="max-w-[70%]">
            <h3 className="text-lg font-semibold mb-2 truncate">
              {files[selectedFileIndex].name}
            </h3>

            <Badge variant="secondary">
              {(files[selectedFileIndex].size / 1024 / 1024).toFixed(2)} MB
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </Button>

            <span className="text-sm whitespace-nowrap">
              {page} / {numPages}
            </span>

            <Button
              size="icon"
              variant="outline"
              disabled={page >= numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>

        <CardContent className="p-0">
          <ScrollArea className="h-190">
            <div className="flex justify-center bg-muted/20 p-6">
              <div
                ref={containerRef}
                className="relative inline-block"
                style={{
                  width: CONTAINER_WIDTH,
                  height: CONTAINER_HEIGHT,
                }}
              >
                {currentFileKind === "pdf" ? (
                  <Document
                    file={files[selectedFileIndex]}
                    loading="Đang tải..."
                    onLoadSuccess={({ numPages }) => {
                      setNumPages(numPages)
                      setPage(1)
                      clearSelection()
                    }}
                    className="border"
                  >
                    <Page
                      pageNumber={page}
                      scale={scale}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                ) : (
                  imageUrl && (
                    <img
                      data-role="preview-image"
                      src={imageUrl}
                      alt={files[selectedFileIndex]?.name}
                      draggable={false}
                      className="block select-none border"
                      style={{
                        maxWidth: CONTAINER_WIDTH,
                        maxHeight: CONTAINER_HEIGHT,
                      }}
                    />
                  )
                )}

                <div
                  className="absolute inset-0 cursor-crosshair select-none"
                  onMouseDown={handleMouseDown}
                >
                  {hasSelection && (
                    <div
                      className="absolute border-2 border-blue-500 bg-blue-500/20"
                      style={{
                        left: selection.x,
                        top: selection.y,
                        width: selection.width,
                        height: selection.height,
                      }}
                    >
                      {!isDragging && (
                        <div
                          className="pointer-events-auto absolute -bottom-9 right-0 flex gap-1"
                          // Ngăn mousedown trên nút bấm khởi tạo một lần kéo chọn mới
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="icon"
                            variant="secondary"
                            disabled={isCropping}
                            onClick={handleCropAll}
                            title={`Crop vùng này trên ${targetFiles.length} file ${FILE_KIND_LABEL[currentFileKind]}`}
                          >
                            <Crop size={16} />
                          </Button>
                          <Button
                            size="icon"
                            variant="secondary"
                            onClick={() => clearSelection()}
                          >
                            <X size={16} />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      {isShowDownloadCol && (
        <Card>
          {isCropping && (
            <Alert>
              <AlertDescription>
                Đang crop {targetFiles.length} file{" "}
                {FILE_KIND_LABEL[currentFileKind]}...
              </AlertDescription>
            </Alert>
          )}

          {croppedImages.length > 0 && (
            <ActionPanel
              handleRotateAllCropped={handleRotateAllCropped}
              isRotatingAll={isRotatingAll}
              croppedImages={croppedImages}
              isCropComplete={isCropComplete}
              pdfFiles={pdfFiles}
              croppedByKind={croppedByKind}
              imageFiles={imageFiles}
              currentFileKind={currentFileKind}
              handleDownloadSheets={handleDownloadSheets}
              isBuildingSheets={isBuildingSheets}
              layout={layout}
              setLayout={setLayout}
            />
          )}
        </Card>
      )}
    </>
  )
}
