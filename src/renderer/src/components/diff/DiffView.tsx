import React, { useMemo, useState, useEffect } from 'react'
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

export default function DiffView({ diff, onAddToClaude, onOpenInEditor }: Props) {
  const sideBySide = useSettingsStore(s => s.sideBySideDiffs)
  const files = useMemo(() => {
    if (!diff.trim()) return []
    try {
      return diffParse(diff)
    } catch {
      return []
    }
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

  return (
    <div className="gh-diff">
      {files.map((file, i) => (
        <DiffFileBlock
          key={`${file.newName}-${i}`}
          file={file}
          onAddToClaude={onAddToClaude}
          onOpenInEditor={onOpenInEditor}
          sideBySide={sideBySide}
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

function DiffFileBlock({
  file,
  onAddToClaude,
  onOpenInEditor,
  sideBySide
}: {
  file: ReturnType<typeof diffParse>[number]
  onAddToClaude?: (filePath: string) => void
  onOpenInEditor?: (filePath: string) => void
  sideBySide: boolean
}) {
  const fileName = file.newName !== '/dev/null' ? file.newName : file.oldName
  const isNew = file.oldName === '/dev/null'
  const isDeleted = file.newName === '/dev/null'
  const isRenamed = file.oldName !== file.newName && !isNew && !isDeleted

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

  return (
    <div className="gh-diff-file">
      <div
        className="gh-diff-file-header"
        onContextMenu={(e) => {
          if (!onAddToClaude && !onOpenInEditor) return
          e.preventDefault()
          setContextMenu(getMenuPosition(e.clientX, e.clientY))
        }}
      >
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

      {!sideBySide && (
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

      {sideBySide && (
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
}
