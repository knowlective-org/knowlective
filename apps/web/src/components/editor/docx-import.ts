// Turning a Word (.docx) file into HTML the editor can parse into blocks.
// Runs in the browser: the document itself is never sent to the server, only
// its images (as attachments of the page).

// Image types /api/files serves inline (INLINE_TYPES there). Word's own
// formats (EMF, WMF) and anything else can't be shown, so they're left out.
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export type DocxResult = {
  html: string;
  // Images left out because the browser can't show their format.
  skippedImages: number;
};

// `uploadImage` stores one image of the document and returns its URL.
export async function docxToHtml(file: File, uploadImage: (image: File) => Promise<string>): Promise<DocxResult> {
  const { default: mammoth } = await import("mammoth");
  const baseName = file.name.replace(/\.docx$/i, "");
  let count = 0;
  let skippedImages = 0;

  const { value } = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const extension = IMAGE_EXTENSIONS[image.contentType];
        if (!extension) {
          skippedImages++;
          return { src: "" };
        }
        const name = `${baseName}-${++count}.${extension}`;
        const bytes = await image.readAsArrayBuffer();
        return { src: await uploadImage(new File([bytes], name, { type: image.contentType })) };
      }),
    },
  );
  return { html: hoistImages(value), skippedImages };
}

// The editor only keeps an image that is a paragraph of its own: one in the
// middle of a sentence, in a table cell or in a list item is dropped. Move
// each of those out, to right after the paragraph / table / list it was in.
function hoistImages(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Where the next image from the same element goes, to keep their order.
  const lastAfter = new Map<Element, Element>();
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    if (!img.getAttribute("src")) {
      img.remove();
      continue;
    }
    let top: Element = img;
    while (top.parentElement && top.parentElement !== doc.body) top = top.parentElement;
    if (top === img) continue;
    if (top.tagName === "P" && top.children.length === 1 && top.firstElementChild === img && !top.textContent?.trim()) {
      continue;
    }
    const paragraph = doc.createElement("p");
    paragraph.append(img);
    (lastAfter.get(top) ?? top).after(paragraph);
    lastAfter.set(top, paragraph);
    if (top.tagName === "P" && !top.textContent?.trim() && !top.querySelector("img")) top.remove();
  }
  return doc.body.innerHTML;
}
