import { Download, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  FILE_KIND_LABEL,
  type FileKind,
  type LayoutOption,
} from "@/components/FilePreview"

const LAYOUT_OPTIONS: LayoutOption[] = [2, 4, 6, 8]

type Props = {
  handleRotateAllCropped: () => Promise<void>
  isRotatingAll: boolean
  croppedImages: {
    file: File
    dataUrl: string
  }[]
  isCropComplete: boolean
  pdfFiles: File[]
  croppedByKind: Record<
    FileKind,
    {
      file: File
      dataUrl: string
    }[]
  >
  imageFiles: File[]
  currentFileKind: FileKind
  handleDownloadSheets: () => Promise<void>
  isBuildingSheets: boolean
  layout: LayoutOption
  setLayout: React.Dispatch<React.SetStateAction<LayoutOption>>
}

export default function ActionPanel({
  handleRotateAllCropped,
  isRotatingAll,
  croppedImages,
  isCropComplete,
  pdfFiles,
  croppedByKind,
  imageFiles,
  currentFileKind,
  handleDownloadSheets,
  isBuildingSheets,
  layout,
  setLayout,
}: Props) {
  return (
    <CardContent className="flex flex-col gap-3 p-4">
      <Button
        size="sm"
        variant="outline"
        onClick={handleRotateAllCropped}
        disabled={isRotatingAll}
        className="w-fit"
      >
        <RotateCw size={16} className="mr-1" />
        {isRotatingAll ? "Đang xoay..." : "Xoay tất cả 90°"}
      </Button>

      <ScrollArea className="max-h-140">
        <div className="flex flex-wrap gap-3 pr-4">
          {croppedImages.map(({ file, dataUrl }) => (
            <div key={file.name} className="flex flex-col items-center gap-1">
              <img
                src={dataUrl}
                alt={`Cropped ${file.name}`}
                className="max-h-32 rounded border"
              />
              <p className="max-w-32 truncate text-xs text-muted-foreground">
                {file.name}
              </p>
            </div>
          ))}
        </div>
      </ScrollArea>

      {!isCropComplete && (
        <Alert>
          <AlertDescription className="space-y-1 text-xs text-orange-600">
            {pdfFiles.length > 0 && (
              <p>
                PDF: {croppedByKind.pdf.length}/{pdfFiles.length} file đã crop
              </p>
            )}
            {imageFiles.length > 0 && (
              <p>
                Ảnh: {croppedByKind.image.length}/{imageFiles.length} file đã
                crop
              </p>
            )}
            <p>
              Cần set vùng chọn và crop đủ{" "}
              {pdfFiles.length > 0 && imageFiles.length > 0
                ? "cả PDF và ảnh"
                : `${FILE_KIND_LABEL[currentFileKind]}`}{" "}
              thì mới tải về được.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Layout mỗi tờ A4</span>
        <div className="flex gap-1">
          {LAYOUT_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={layout === opt ? "default" : "outline"}
              onClick={() => setLayout(opt)}
              className="w-10"
            >
              {opt}
            </Button>
          ))}
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={handleDownloadSheets}
        disabled={isBuildingSheets || !isCropComplete}
        className="w-fit"
      >
        <Download size={16} className="mr-1" />
        {isBuildingSheets
          ? "Đang ghép tờ A4..."
          : `Tải về khổ A4 (${Math.ceil(croppedImages.length / layout)} tờ)`}
      </Button>
    </CardContent>
  )
}
