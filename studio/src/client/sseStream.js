export async function* streamSseEvents(response) {
  if (!response.body) {
    yield* parseSseText(await response.text());
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    for (const event of parseSseText(buffer)) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function* parseSseText(text) {
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const event = parseSseFrame(frame);
    if (event) yield event;
  }
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let type = null;
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!type || dataLines.length === 0) return null;
  const dataText = dataLines.join("\n");
  return { type, data: dataText ? JSON.parse(dataText) : null };
}
