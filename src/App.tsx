import FilePreview from "@/components/FilePreview"
import Dropzone from "./components/Dropzone"
import { useState } from "react"

function App() {
  const [files, setFiles] = useState<File[]>([])
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)

  return (
    <div className="p-4 grid grid-cols-[20%_minmax(0,1fr)_20%] gap-4">
      <Dropzone
        value={files}
        onChange={setFiles}
        setSelectedFileIndex={setSelectedFileIndex}
      />
      <FilePreview files={files} selectedFileIndex={selectedFileIndex} />
    </div>
  )
}

export default App
