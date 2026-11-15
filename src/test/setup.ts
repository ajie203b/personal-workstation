if (typeof Range !== 'undefined' && typeof DOMRect !== 'undefined') {
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  Range.prototype.getClientRects ??= () => {
    const rects: DOMRect[] = []
    return Object.assign(rects, { item: (index: number) => rects[index] ?? null })
  }
}
