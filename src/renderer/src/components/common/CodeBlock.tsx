import React, { useCallback } from 'react'

interface Props {
  language?: string
  children: string
}

export default function CodeBlock({ language, children }: Props) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children)
  }, [children])

  return (
    <div className="code-block">
      <div className="code-block-header">
        {language && <span className="code-lang">{language}</span>}
        <button className="btn-copy" onClick={handleCopy} title="Copy">
          Copy
        </button>
      </div>
      <pre>
        <code className={language ? `language-${language}` : ''}>
          {children}
        </code>
      </pre>
    </div>
  )
}
