import React, { useMemo, useState, useEffect, useRef, useCallback, startTransition, memo } from 'react'
import { parse as diffParse } from 'diff2html'
import { createPortal } from 'react-dom'
import { useSettingsStore } from '../../stores/settingsStore'

interface Props {
  diff: string
  onAddToClaude?: (filePath: string) => void
  onOpenInEditor?: (filePath: string) => void
}

// Safety cap: truncate per-file lines to prevent DOM explosion
const MAX_LINES_PER_FILE = 2000
// Auto-collapse file bodies when diff has more files than this
const AUTO_COLLAPSE_THRESHOLD = 10

export default function DiffView({ diff, onAddToClaude, onOpenInEditor }: Props) {
  const sideBySide = useSettingsStore(s => s.sideBySideDiffs)
  const [files, setFiles] = useState<ReturnType<typeof diffParse>>([])

  // Parse diff in a transition so it doesn't block the UI
  useMemo(() => {
    if (!diff.trim()) {
      setFiles([])
      return
    }
    startTransition(() => {
      try {
        setFiles(diffParse(diff))
      } catch {
        setFiles([])
      }
    })
  }, [diff])

  if (!diff.trim()) {
    return <div className="diff-empty">No changes</div>
  }

  if (files.length === 0) {
    return (
      <div className="gh-diff">
        <pre className="gh-diff-fallback">{diff}</pre>
      </div>
    )
  }

  const autoCollapse = files.length > AUTO_COLLAPSE_THRESHOLD

  return (
    <div className="gh-diff">
      {files.map((file, i) => (
        <DiffFileBlock
          key={`${file.newName}-${i}`}
          file={file}
          onAddToClaude={onAddToClaude}
          onOpenInEditor={onOpenInEditor}
          sideBySide={sideBySide}
          defaultCollapsed={autoCollapse}
        />
      ))}
    </div>
  )
}

function getMenuPosition(clientX: number, clientY: number) {
  const MENU_WIDTH = 180
  const MENU_HEIGHT = 110
  const PADDING = 8
  return {
    x: Math.max(PADDING, Math.min(clientX, window.innerWidth - MENU_WIDTH - PADDING)),
    y: Math.max(PADDING, Math.min(clientY, window.innerHeight - MENU_HEIGHT - PADDING))
  }
}

const DiffFileBlock = memo(function DiffFileBlock({
  file,
  onAddToClaude,
  onOpenInEditor,
  sideBySide,
  defaultCollapsed = false
}: {
  file: ReturnType<typeof diffParse>[number]
  onAddToClaude?: (filePath: string) => void
  onOpenInEditor?: (filePath: string) => void
  sideBySide: boolean
  defaultCollapsed?: boolean
}) {
  const fileName = file.newName !== '/dev/null' ? file.newName : file.oldName
  const isNew = file.oldName === '/dev/null'
  const isDeleted = file.newName === '/dev/null'
  const isRenamed = file.oldName !== file.newName && !isNew && !isDeleted

  // Collapse / expand state
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  // Lazy rendering: only render body when scrolled into view
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [hasBeenVisible, setHasBeenVisible] = useState(!defaultCollapsed)

  useEffect(() => {
    if (hasBeenVisible || collapsed) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasBeenVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' } // start rendering 200px before visible
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasBeenVisible, collapsed])

  // Count total lines in this file
  const fileLineCount = useMemo(() => {
    let count = 0
    for (const b of file.blocks) count += b.lines.length
    return count
  }, [file])

  const needsTruncation = fileLineCount > MAX_LINES_PER_FILE
  const [showAllLines, setShowAllLines] = useState(false)

  // Build truncated blocks if needed
  const displayBlocks = useMemo(() => {
    if (!needsTruncation || showAllLines) return file.blocks
    let remaining = MAX_LINES_PER_FILE
    const truncated: typeof file.blocks = []
    for (const block of file.blocks) {
      if (remaining <= 0) break
      if (block.lines.length <= remaining) {
        truncated.push(block)
        remaining -= block.lines.length
      } else {
        truncated.push({ ...block, lines: block.lines.slice(0, remaining) })
        remaining = 0
      }
    }
    return truncated
  }, [file.blocks, needsTruncation, showAllLines])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  const shouldRenderBody = hasBeenVisible && !collapsed

  return (
    <div className="gh-diff-file">
      <div
        className="gh-diff-file-header"
        onClick={() => setCollapsed(c => !c)}
        style={{ cursor: 'pointer' }}
        onContextMenu={(e) => {
          if (!onAddToClaude && !onOpenInEditor) return
          e.preventDefault()
          setContextMenu(getMenuPosition(e.clientX, e.clientY))
        }}
      >
        <span className="gh-diff-collapse-icon" style={{ marginRight: 4, opacity: 0.6, fontSize: 10 }}>
          {collapsed ? '\u25B8' : '\u25BE'}
        </span>
        <span className="gh-diff-stats">
          {file.addedLines > 0 && (
            <span className="gh-diff-stat-add">+{file.addedLines}</span>
          )}
          {file.deletedLines > 0 && (
            <span className="gh-diff-stat-del">&minus;{file.deletedLines}</span>
          )}
        </span>
        <span className="gh-diff-filename">
          {isRenamed
            ? `${file.oldName} \u2192 ${fileName}`
            : fileName.replace(/^[ab]\//, '')}
        </span>
        {isNew && <span className="gh-diff-badge gh-diff-badge-new">New</span>}
        {isDeleted && (
          <span className="gh-diff-badge gh-diff-badge-del">Deleted</span>
        )}
      </div>

      {/* Sentinel for IntersectionObserver lazy loading */}
      <div ref={sentinelRef} />

      {shouldRenderBody && !sideBySide && (
        <div className="gh-diff-file-body">
          <table className="gh-diff-table">
            <tbody>
              {displayBlocks.map((block, bi) => (
                <React.Fragment key={bi}>
                  <tr className="gh-diff-hunk">
                    <td className="gh-diff-ln gh-diff-ln-old" />
                    <td className="gh-diff-ln gh-diff-ln-new" />
                    <td className="gh-diff-hunk-content">{block.header}</td>
                  </tr>
                  {block.lines.map((line, li) => {
                    const type =
                      line.type === 'insert'
                        ? 'add'
                        : line.type === 'delete'
                          ? 'del'
                          : 'ctx'
                    const prefix =
                      type === 'add' ? '+' : type === 'del' ? '\u2212' : '\u00A0'
                    const content = line.content.substring(1)

                    return (
                      <tr key={li} className={`gh-diff-line gh-diff-line-${type}`}>
                        <td className="gh-diff-ln gh-diff-ln-old">
                          {line.type !== 'insert' ? line.oldNumber : ''}
                        </td>
                        <td className="gh-diff-ln gh-diff-ln-new">
                          {line.type !== 'delete' ? line.newNumber : ''}
                        </td>
                        <td className="gh-diff-code">
                          <span className="gh-diff-prefix">{prefix}</span>
                          <span className="gh-diff-code-inner">{content}</span>
                        </td>
                      </tr>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {needsTruncation && !showAllLines && (
            <div className="gh-diff-truncated">
              <button className="btn btn-sm" onClick={() => setShowAllLines(true)}>
                Show all {fileLineCount.toLocaleString()} lines ({(fileLineCount - MAX_LINES_PER_FILE).toLocaleString()} more)
              </button>
            </div>
          )}
        </div>
      )}

      {shouldRenderBody && sideBySide && (
        <div className="gh-diff-file-body gh-diff-side-by-side">
          <div className="gh-diff-side gh-diff-side-old">
            <table className="gh-diff-table">
              <tbody>
                {displayBlocks.map((block, bi) => (
                  <React.Fragment key={bi}>
                    <tr className="gh-diff-hunk">
                      <td className="gh-diff-ln gh-diff-ln-old" />
                      <td className="gh-diff-hunk-content">{block.header}</td>
                    </tr>
                    {block.lines.map((line, li) => {
                      if (line.type === 'insert') {
                        return (
                          <tr key={li} className="gh-diff-line gh-diff-line-ctx gh-diff-line-empty">
                            <td className="gh-diff-ln gh-diff-ln-old" />
                            <td className="gh-diff-code" />
                          </tr>
                        )
                      }
                      const type = line.type === 'delete' ? 'del' : 'ctx'
                      const prefix = type === 'del' ? '\u2212' : '\u00A0'
                      const content = line.content.substring(1)
                      return (
                        <tr key={li} className={`gh-diff-line gh-diff-line-${type}`}>
                          <td className="gh-diff-ln gh-diff-ln-old">{line.oldNumber}</td>
                          <td className="gh-diff-code">
                            <span className="gh-diff-prefix">{prefix}</span>
                            <span className="gh-diff-code-inner">{content}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="gh-diff-side gh-diff-side-new">
            <table className="gh-diff-table">
              <tbody>
                {displayBlocks.map((block, bi) => (
                  <React.Fragment key={bi}>
                    <tr className="gh-diff-hunk">
                      <td className="gh-diff-ln gh-diff-ln-new" />
                      <td className="gh-diff-hunk-content">{block.header}</td>
                    </tr>
                    {block.lines.map((line, li) => {
                      if (line.type === 'delete') {
                        return (
                          <tr key={li} className="gh-diff-line gh-diff-line-ctx gh-diff-line-empty">
                            <td className="gh-diff-ln gh-diff-ln-new" />
                            <td className="gh-diff-code" />
                          </tr>
                        )
                      }
                      const type = line.type === 'insert' ? 'add' : 'ctx'
                      const prefix = type === 'add' ? '+' : '\u00A0'
                      const content = line.content.substring(1)
                      return (
                        <tr key={li} className={`gh-diff-line gh-diff-line-${type}`}>
                          <td className="gh-diff-ln gh-diff-ln-new">{line.newNumber}</td>
                          <td className="gh-diff-code">
                            <span className="gh-diff-prefix">{prefix}</span>
                            <span className="gh-diff-code-inner">{content}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {needsTruncation && !showAllLines && (
            <div className="gh-diff-truncated">
              <button className="btn btn-sm" onClick={() => setShowAllLines(true)}>
                Show all {fileLineCount.toLocaleString()} lines ({(fileLineCount - MAX_LINES_PER_FILE).toLocaleString()} more)
              </button>
            </div>
          )}
        </div>
      )}

      {contextMenu && createPortal(
        <div
          className="context-menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 160),
            ...(contextMenu.y + 120 > window.innerHeight
              ? { bottom: window.innerHeight - contextMenu.y }
              : { top: contextMenu.y })
          }}
        >
          {onOpenInEditor && (
            <button
              className="context-menu-item"
              onClick={() => {
                onOpenInEditor(fileName.replace(/^[ab]\//, ''))
                setContextMenu(null)
              }}
            >
              Open in editor
            </button>
          )}
          {onAddToClaude && (
            <button
              className="context-menu-item"
              onClick={() => {
                onAddToClaude(fileName)
                setContextMenu(null)
              }}
            >
              Add to Claude
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
})
