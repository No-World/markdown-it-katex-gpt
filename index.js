import katex from 'katex'

const defaultOptions = {
  delimiters: [
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false }
  ]
}

/**
 * Block 规则：处理 display mode 的多行公式
 * 这解决了跨行 LaTeX 被 markdown-it 按行解析导致失败的问题
 */
function mathBlockRule(options) {
  // 获取所有 display mode 的分隔符
  const displayDelimiters = options.delimiters.filter(d => d.display)

  return (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine]
    const maxPos = state.eMarks[startLine]
    const lineText = state.src.slice(startPos, maxPos)

    // 检查是否以任何一个 display 左分隔符开始
    let matchedDelimiter = null
    for (const delim of displayDelimiters) {
      if (lineText.startsWith(delim.left)) {
        matchedDelimiter = delim
        break
      }
    }

    if (!matchedDelimiter) return false

    const { left, right } = matchedDelimiter

    // 从当前行开始搜索右分隔符
    let content = ''
    let nextLine = startLine
    let found = false

    // 获取第一行的内容（跳过左分隔符）
    let firstLineContent = lineText.slice(left.length)

    // 检查右分隔符是否在同一行
    const rightPosInFirstLine = firstLineContent.indexOf(right)
    if (rightPosInFirstLine !== -1) {
      // 同一行内找到右分隔符
      content = firstLineContent.slice(0, rightPosInFirstLine)
      found = true
      // 对于同一行的情况，需要检查右分隔符后是否还有内容
      // 如果有，这可能不应该作为 block 匹配（留给 inline 处理）
      const afterRight = firstLineContent.slice(rightPosInFirstLine + right.length).trim()
      if (afterRight) {
        // 有其他内容，不作为 block 处理
        return false
      }
      nextLine = startLine + 1
    } else {
      // 需要搜索后续行
      content = firstLineContent + '\n'
      nextLine = startLine + 1

      while (nextLine < endLine) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
        const lineEnd = state.eMarks[nextLine]
        const currentLine = state.src.slice(lineStart, lineEnd)

        const rightPos = currentLine.indexOf(right)
        if (rightPos !== -1) {
          // 找到右分隔符
          content += currentLine.slice(0, rightPos)
          found = true
          // 检查右分隔符后是否还有内容
          const afterRight = currentLine.slice(rightPos + right.length).trim()
          if (afterRight) {
            // 右分隔符后还有内容，不匹配
            return false
          }
          nextLine++
          break
        } else {
          content += currentLine + '\n'
        }
        nextLine++
      }
    }

    if (!found) return false

    // 如果是静默模式，只返回匹配成功
    if (silent) return true

    // 渲染 LaTeX
    try {
      const renderedContent = katex.renderToString(content.trim(), {
        throwOnError: false,
        output: 'mathml',
        displayMode: true
      })

      const token = state.push('math_block', 'math', 0)
      token.content = renderedContent
      token.map = [startLine, nextLine]
      token.block = true
    } catch (e) {
      console.error('KaTeX block rendering error:', e)
      return false
    }

    state.line = nextLine
    return true
  }
}

/**
 * Inline 规则：处理行内公式和单行 display 公式
 */
function mathInlineRule(options) {
  return (state, silent) => {
    const max = state.posMax
    const start = state.pos

    for (const { left, right, display } of options.delimiters) {
      // 检查是否以左标记开始
      if (!state.src.slice(start).startsWith(left)) continue

      // 跳过左标记的长度
      let pos = start + left.length

      // 寻找匹配的右标记（只在当前行内搜索）
      while (pos < max) {
        // 如果遇到换行符，停止搜索（让 block 规则处理多行情况）
        if (state.src[pos] === '\n') break
        if (state.src.slice(pos).startsWith(right)) {
          break
        }
        pos++
      }

      // 没找到匹配的右标记或遇到换行，跳过
      if (pos >= max || state.src[pos] === '\n') continue
      if (!state.src.slice(pos).startsWith(right)) continue

      // 如果不是静默模式，将 LaTeX 公式转换为 MathML
      if (!silent) {
        const content = state.src.slice(start + left.length, pos)
        try {
          const renderedContent = katex.renderToString(content, {
            throwOnError: false,
            output: 'mathml',
            displayMode: display
          })
          const token = state.push('html_inline', '', 0)
          token.content = renderedContent
        } catch (e) {
          console.error('KaTeX inline rendering error:', e)
        }
      }

      // 更新位置，跳过右标记的长度
      state.pos = pos + right.length
      return true
    }

    return false
  }
}

/**
 * 渲染 math_block token
 */
function mathBlockRenderer(tokens, idx) {
  return tokens[idx].content
}

export default function (md, options = defaultOptions) {
  // 添加 block 规则处理多行 display 公式
  md.block.ruler.before('fence', 'math_block', mathBlockRule(options))

  // 添加 inline 规则处理行内公式
  md.inline.ruler.after('text', 'math_inline', mathInlineRule(options))

  // 添加 math_block 的渲染器
  md.renderer.rules.math_block = mathBlockRenderer
}