import React, { useMemo, useState } from 'react'
import { parse as diffParse } from 'diff2html'

interface Props {
  diff: string
}

export default function DiffView({ diff }: Props) {
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
        <DiffFileBlock key={`${file.newName}-${i}`} file={file} />
      ))}
    </div>
  )
}

function DiffFileBlock({ file }: { file: ReturnType<typeof diffParse>[number] }) {
  const [collapsed, setCollapsed] = useState(false)
  const fileName = file.newName !== '/dev/null' ? file.newName : file.oldName
  const isNew = file.oldName === '/dev/null'
  const isDeleted = file.newName === '/dev/null'
  const isRenamed = file.oldName !== file.newName && !isNew && !isDeleted

  return (
    <div className={`gh-diff-file ${collapsed ? 'collapsed' : ''}`}>
      <button
        className="gh-diff-file-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="gh-diff-chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
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
      </button>

      {!collapsed && (
        <div className="gh-diff-file-body">
          <table className="gh-diff-table">
            <tbody>
              {file.blocks.map((block, bi) => (
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
        </div>
      )}
    </div>
  )
}
