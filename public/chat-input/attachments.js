(function() {
  'use strict';

  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const pendingAttachments = [];
  let fileInputElement = null;

  function initAttachments() {
    const inputArea = document.getElementById('chat-input-area');
    if (!inputArea) return;
    if (inputArea.dataset.attachmentsInitialized === '1') return;

    fileInputElement = document.getElementById('file-input');
    if (!fileInputElement) {
      fileInputElement = document.createElement('input');
      fileInputElement.id = 'file-input';
      fileInputElement.type = 'file';
      fileInputElement.accept = 'image/*';
      fileInputElement.multiple = true;
      fileInputElement.style.display = 'none';
      inputArea.appendChild(fileInputElement);
    }

    let attachBtn = document.getElementById('chat-attach-btn');
    if (!attachBtn) {
      attachBtn = document.createElement('button');
      attachBtn.id = 'chat-attach-btn';
      attachBtn.className = 'chat-attach-btn';
      attachBtn.title = 'Attach image';
      attachBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
      inputArea.appendChild(attachBtn);
    }

    attachBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      fileInputElement.click();
    });

    fileInputElement.addEventListener('change', function(e) {
      handleFiles(e.target.files);
      fileInputElement.value = '';
    });

    inputArea.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
        inputArea.classList.add('drag-over');
      }
    });

    inputArea.addEventListener('dragleave', function(e) {
      e.preventDefault();
      e.stopPropagation();
      inputArea.classList.remove('drag-over');
    });

    inputArea.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      inputArea.classList.remove('drag-over');

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFiles(files);
      }
    });

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('paste', function(e) {
        const items = e.clipboardData.items;
        if (!items) return;

        const imageFiles = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
              imageFiles.push(file);
            }
          }
        }

        if (imageFiles.length > 0) {
          e.preventDefault();
          handleFiles(imageFiles);
        }
      });
    }

    inputArea.dataset.attachmentsInitialized = '1';
  }

  function validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      alert('File too large. Maximum size is 5MB.');
      return false;
    }
    if (!file.type.startsWith('image/')) {
      alert('Only image files are allowed.');
      return false;
    }
    return true;
  }

  function handleFiles(files) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (!validateFile(file)) {
        continue;
      }

      const attachment = {
        file: file,
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9)
      };

      pendingAttachments.push(attachment);

      fileToBase64(file).then(function(dataUrl) {
        attachment.dataUrl = dataUrl;
        renderPreviews();
      }).catch(function() {
        const index = pendingAttachments.indexOf(attachment);
        if (index !== -1) {
          pendingAttachments.splice(index, 1);
          renderPreviews();
        }
      });
    }
  }

  function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = function(e) {
        resolve(e.target.result);
      };
      reader.onerror = function(e) {
        reject(e);
      };
      reader.onabort = function(e) {
        reject(e);
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPreviews() {
    const existing = document.querySelector('.attachment-previews');
    if (existing) existing.remove();

    if (pendingAttachments.length === 0) return;

    const inputArea = document.getElementById('chat-input-area');
    if (!inputArea) return;

    const previewsContainer = document.createElement('div');
    previewsContainer.className = 'attachment-previews';

    pendingAttachments.forEach(function(attachment, index) {
      const preview = createPreviewElement(attachment, index);
      previewsContainer.appendChild(preview);
    });

    inputArea.parentNode.insertBefore(previewsContainer, inputArea);
  }

  function createPreviewElement(attachment, index) {
    const preview = document.createElement('div');
    preview.className = 'attachment-preview';

    const img = document.createElement('img');
    img.src = attachment.dataUrl;
    img.alt = attachment.file.name;
    preview.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-remove';
    removeBtn.innerHTML = '×';
    removeBtn.title = 'Remove';
    removeBtn.onclick = function(e) {
      e.stopPropagation();
      removeAttachment(index);
    };
    preview.appendChild(removeBtn);

    return preview;
  }

  function removeAttachment(index) {
    if (index >= 0 && index < pendingAttachments.length) {
      pendingAttachments.splice(index, 1);
      renderPreviews();
    }
  }

  function attachmentToMessageAttachment(attachment) {
    if (!attachment || typeof attachment.dataUrl !== 'string') return null;

    const match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: match[1],
        data: match[2]
      }
    };
  }

  function getAttachments() {
    return pendingAttachments
      .map(attachmentToMessageAttachment)
      .filter(function(attachment) { return attachment !== null; });
  }

  function clearSentAttachments() {
    for (let i = pendingAttachments.length - 1; i >= 0; i--) {
      if (attachmentToMessageAttachment(pendingAttachments[i])) {
        pendingAttachments.splice(i, 1);
      }
    }
    renderPreviews();
  }

  function clearAttachments() {
    pendingAttachments.length = 0;
    renderPreviews();
  }

  function addAttachment(file) {
    const attachment = {
      file: file,
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9)
    };
    pendingAttachments.push(attachment);
    renderPreviews();
  }

  window.ChatInputAttachments = {
    initAttachments: initAttachments,
    validateFile: validateFile,
    pendingAttachments: pendingAttachments,
    addAttachment: addAttachment,
    removeAttachment: removeAttachment,
    createPreviewElement: createPreviewElement,
    fileToBase64: fileToBase64,
    clearAttachments: clearAttachments,
    clearSentAttachments: clearSentAttachments,
    getAttachments: getAttachments
  };
})();
