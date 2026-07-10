import { useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { FileText, ImageIcon, UploadCloud, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

interface DropzoneProps {
  value: File[]
  onChange: (files: File[]) => void
  maxFiles?: number
  disabled?: boolean
  setSelectedFileIndex: React.Dispatch<React.SetStateAction<number>>
}

export default function Dropzone({
  value,
  onChange,
  maxFiles = Infinity,
  disabled = false,
  setSelectedFileIndex,
}: DropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const merged = [...value]

      acceptedFiles.forEach((file) => {
        const exists = merged.some(
          (f) =>
            f.name === file.name &&
            f.size === file.size &&
            f.lastModified === file.lastModified,
        )

        if (!exists) {
          merged.push(file)
        }
      })

      onChange(merged.slice(0, maxFiles))
    },
    [value, onChange, maxFiles],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    disabled,
    accept: {
      "application/pdf": [".pdf"],
      "image/*": [".png", ".jpg", ".jpeg"],
    },
  })

  const removeFile = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      <Card
        {...getRootProps()}
        className={cn(
          "cursor-pointer border border-dashed p-10 transition-colors",
          "flex flex-col items-center justify-center text-center",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 hover:border-primary",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input {...getInputProps()} />

        <UploadCloud className="mb-4 h-10 w-10 text-muted-foreground" />

        <h3 className="font-semibold">
          {isDragActive
            ? "Thả PDF hoặc ảnh vào đây..."
            : "Kéo thả PDF hoặc ảnh"}
        </h3>

        <p className="mt-2 text-sm text-muted-foreground">
          hoặc ấn để chọn PDF hoặc ảnh (.pdf, .png, .jpg, .jpeg)
        </p>
      </Card>

      {value.length > 0 && (
        <ScrollArea className="h-120 border">
          <div className="space-y-2 p-3">
            {value.map((file, index) => (
              <div
                key={`${file.name}-${file.lastModified}`}
                className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:opacity-70"
                onClick={() => setSelectedFileIndex(index)}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  {file.type.startsWith("image/") ? (
                    <ImageIcon className="h-5 w-5 shrink-0 text-blue-500" />
                  ) : (
                    <FileText className="h-5 w-5 shrink-0 text-red-500" />
                  )}

                  <div className="overflow-hidden">
                    <p className="truncate font-medium">{file.name}</p>

                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>

                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFile(index)
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
