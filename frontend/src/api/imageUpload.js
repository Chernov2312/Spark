const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_IMAGE_TYPES = new Set([
  ...IMAGE_TYPES,
  "image/gif",
]);
const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_QUALITY = 0.82;

function getImageExtension(file) {
  const extensionByType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  if (extensionByType[file.type]) return extensionByType[file.type];

  const suffix = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase()
    : "";
  return suffix && /^[a-z0-9]{1,12}$/.test(suffix) ? suffix : "bin";
}

function canvasToWebp(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Не удалось сжать изображение"));
        }
      },
      "image/webp",
      IMAGE_QUALITY,
    );
  });
}

export async function compressImage(file) {
  if (!IMAGE_TYPES.has(file.type)) return file;
  if (typeof createImageBitmap !== "function") {
    throw new Error("Браузер не поддерживает обработку изображений");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Не удалось подготовить изображение к сжатию");
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await canvasToWebp(canvas);
    if (compressed.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([compressed], `${baseName}.webp`, {
      type: compressed.type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}

function getApiErrorMessage(error) {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join("; ");
  }
  return error.message || "Не удалось запросить ссылку для загрузки файла";
}

export async function uploadToTemporaryUrl(
  api,
  file,
  { type, targetId, maxSizeBytes, compress = true },
) {
  const uploadFile = compress ? await compressImage(file) : file;
  if (maxSizeBytes && uploadFile.size > maxSizeBytes) {
    throw new Error(
      `Файл слишком большой (максимум ${Math.floor(maxSizeBytes / 1024 / 1024)} МБ после сжатия)`,
    );
  }

  const fileExtension = getImageExtension(uploadFile);
  if (!fileExtension) {
    throw new Error("Не удалось определить расширение файла");
  }
  if (!targetId) {
    throw new Error("Не удалось определить ID пользователя или чата");
  }

  let temporaryUpload;
  try {
    const { data } = await api.post("/attachments/temporary-url", {
      file_extension: fileExtension,
      file_content: uploadFile.type || "application/octet-stream",
      target_id: targetId,
      type,
    });
    temporaryUpload = data;
  } catch (error) {
    throw new Error(getApiErrorMessage(error), { cause: error });
  }

  if (!temporaryUpload?.temporary_url || !temporaryUpload?.file_key) {
    throw new Error("Сервер не вернул временную ссылку или ключ файла");
  }

  let response;
  try {
    response = await fetch(temporaryUpload.temporary_url, {
      method: "PUT",
      headers: {
        "Content-Type": uploadFile.type || "application/octet-stream",
      },
      body: uploadFile,
    });
  } catch (error) {
    throw new Error("Не удалось загрузить файл в хранилище", { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      `Хранилище отклонило загрузку файла (HTTP ${response.status})`,
    );
  }

  return {
    file: uploadFile,
    fileKey: temporaryUpload.file_key,
  };
}

export function getAvatarImageError(file) {
  if (!AVATAR_IMAGE_TYPES.has(file.type)) {
    return "Поддерживаются только JPEG, PNG, WebP и GIF";
  }
  return null;
}
