import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { CloudUpload, FileUp, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing?: boolean;
}

export function FileUpload({ onFileSelect, isProcessing = false }: FileUploadProps) {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setSelectedFileName(file.name);
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf'],
    },
    multiple: false,
    disabled: isProcessing,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <Card
        {...getRootProps()}
        className={`
          relative overflow-visible cursor-pointer transition-all duration-300
          border-2 border-dashed p-12
          ${isDragActive 
            ? 'border-primary bg-gradient-to-br from-primary/20 via-primary/10 to-chart-3/20 shadow-lg shadow-primary/20 scale-105' 
            : 'border-primary/30 bg-gradient-to-br from-card/50 via-card to-card/50 backdrop-blur-sm hover-elevate'
          }
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        data-testid="upload-dropzone"
      >
        <input {...getInputProps()} data-testid="input-file" />
        
        <div className="flex flex-col items-center justify-center gap-6 text-center relative">
          <AnimatePresence mode="wait">
            {isDragActive ? (
              <motion.div
                key="drag-active"
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, rotate: 180 }}
                transition={{ duration: 0.3, ease: "backOut" }}
                className="relative"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 bg-gradient-to-r from-primary/40 to-chart-3/40 rounded-full blur-xl"
                />
                <FileUp className="w-20 h-20 text-primary relative z-10" />
              </motion.div>
            ) : (
              <motion.div
                key="default"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.3 }}
                className="relative"
              >
                <motion.div
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 0.8, 0.5],
                  }}
                  transition={{ 
                    duration: 3, 
                    repeat: Infinity, 
                    ease: "easeInOut" 
                  }}
                  className="absolute inset-0 bg-gradient-to-r from-primary/30 to-chart-4/30 rounded-full blur-2xl"
                />
                <CloudUpload className="w-20 h-20 text-primary relative z-10" />
                <motion.div
                  animate={{ 
                    y: [0, -10, 0],
                  }}
                  transition={{ 
                    duration: 2, 
                    repeat: Infinity, 
                    ease: "easeInOut" 
                  }}
                  className="absolute -top-2 -right-2"
                >
                  <Sparkles className="w-6 h-6 text-chart-4" />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          
          <motion.div 
            className="space-y-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <h3 className="text-xl font-bold bg-gradient-to-r from-foreground via-primary to-chart-3 bg-clip-text text-transparent">
              {isDragActive ? 'Отпустите файл здесь' : 'Загрузите данные о продажах'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
              Перетащите файл Excel, CSV или PDF сюда или нажмите для выбора
            </p>
          </motion.div>

          <motion.div 
            className="flex gap-2 flex-wrap justify-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {['.xlsx', '.xls', '.csv', '.pdf'].map((format, index) => (
              <motion.div
                key={format}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 + index * 0.1, type: "spring" }}
                whileHover={{ scale: 1.1 }}
              >
                <Badge 
                  variant="secondary" 
                  className="font-mono text-xs px-3 py-1 bg-gradient-to-r from-primary/10 to-chart-3/10 border-primary/20" 
                  data-testid={`badge-format-${format.replace('.', '')}`}
                >
                  {format}
                </Badge>
              </motion.div>
            ))}
          </motion.div>

          <AnimatePresence>
            {selectedFileName && !isProcessing && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: -10 }}
                className="mt-2 p-3 bg-gradient-to-r from-primary/10 to-chart-2/10 rounded-lg border border-primary/20"
              >
                <p className="text-sm text-muted-foreground">
                  Выбран: <span className="font-semibold text-foreground">{selectedFileName}</span>
                </p>
              </motion.div>
            )}

            {isProcessing && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-3 text-primary mt-2"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-5 h-5 border-3 border-current border-t-transparent rounded-full"
                />
                <span className="text-sm font-semibold">Обработка файла...</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>
    </motion.div>
  );
}
