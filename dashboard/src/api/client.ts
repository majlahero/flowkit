const BASE = ''  // same origin, proxied by Vite in dev

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${err}`)
  }
  return res.json()
}

export async function patchAPI<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return fetchAPI<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function postAPI<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return fetchAPI<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

/** Read a File as a base64 data URL and return just the base64 payload (no prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const idx = result.indexOf('base64,')
      resolve(idx >= 0 ? result.slice(idx + 'base64,'.length) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/** Upload a browser-selected image to Google Flow via base64 JSON; returns its media_id. */
export async function uploadImageData(file: File, projectId: string): Promise<{ media_id: string | null; raw: unknown }> {
  const image_base64 = await fileToBase64(file)
  return postAPI('/api/flow/upload-image-file', {
    image_base64,
    mime_type: file.type || 'image/png',
    project_id: projectId,
    file_name: file.name || 'image.png',
  })
}
