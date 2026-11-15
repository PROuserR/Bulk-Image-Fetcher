/**
 * FullRes Image Scraper - Modern ES6 Frontend Script
 * Manages scraping requests, gallery views, filtering, batch selection, ZIP export, and modal lightbox.
 */

class FullResApp {
  constructor() {
    this.images = [];
    this.selectedIds = new Set();
    this.currentImage = null;

    this.initElements();
    this.initEvents();
    this.initTheme();
  }

  initElements() {
    this.scrapeForm = document.getElementById('scrapeForm');
    this.urlInput = document.getElementById('urlInput');
    this.scrapeBtn = document.getElementById('scrapeBtn');
    this.themeToggleBtn = document.getElementById('themeToggleBtn');
    this.quickSampleBtn = document.getElementById('quickSampleBtn');

    this.resultsSection = document.getElementById('gallery-section');
    this.emptyState = document.getElementById('emptyState');
    this.imageGrid = document.getElementById('imageGrid');

    this.resultPageTitle = document.getElementById('resultPageTitle');
    this.statTotalCount = document.getElementById('statTotalCount');
    this.statUnshrunkCount = document.getElementById('statUnshrunkCount');
    this.statUrlText = document.getElementById('statUrlText');

    this.formatFilter = document.getElementById('formatFilter');
    this.resolutionFilter = document.getElementById('resolutionFilter');

    this.selectAllCheckbox = document.getElementById('selectAllCheckbox');
    this.selectedCountText = document.getElementById('selectedCountText');
    this.downloadZipBtn = document.getElementById('downloadZipBtn');

    this.followLinkedCheckbox = document.getElementById('followLinkedCheckbox');

    // Lightbox modal elements
    this.lightboxModal = document.getElementById('lightboxModal');
    this.closeLightboxBtn = document.getElementById('closeLightboxBtn');
    this.lightboxImg = document.getElementById('lightboxImg');
    this.lightboxTitle = document.getElementById('lightboxTitle');
    this.lightboxBadge = document.getElementById('lightboxBadge');
    this.metaDimensions = document.getElementById('metaDimensions');
    this.metaFormat = document.getElementById('metaFormat');
    this.metaTier = document.getElementById('metaTier');
    this.metaMethod = document.getElementById('metaMethod');
    this.metaFullUrl = document.getElementById('metaFullUrl');
    this.openNewWebpageBtn = document.getElementById('openNewWebpageBtn');
    this.metaLinkedPageBlock = document.getElementById('metaLinkedPageBlock');
    this.metaLinkedPageLink = document.getElementById('metaLinkedPageLink');
    this.downloadSingleBtn = document.getElementById('downloadSingleBtn');
    this.copyUrlBtn = document.getElementById('copyUrlBtn');

    // Links Modal elements
    this.linksModal = document.getElementById('linksModal');
    this.openLinksModalBtn = document.getElementById('openLinksModalBtn');
    this.closeLinksModalBtn = document.getElementById('closeLinksModalBtn');
    this.showDirectLinksBtn = document.getElementById('showDirectLinksBtn');
    this.showWebpageLinksBtn = document.getElementById('showWebpageLinksBtn');
    this.linksTextarea = document.getElementById('linksTextarea');
    this.linksCountStatus = document.getElementById('linksCountStatus');
    this.copyAllLinksBtn = document.getElementById('copyAllLinksBtn');
    this.downloadLinksTxtBtn = document.getElementById('downloadLinksTxtBtn');
    this.downloadLinksCsvBtn = document.getElementById('downloadLinksCsvBtn');
    this.downloadLinksJsonBtn = document.getElementById('downloadLinksJsonBtn');
    this.downloadLinksZipBtn = document.getElementById('downloadLinksZipBtn');
    this.linksViewMode = 'direct';
  }

  initEvents() {
    // Theme toggle
    this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());

    // Filter controls
    this.formatFilter.addEventListener('change', () => this.renderGallery());
    this.resolutionFilter.addEventListener('change', () => this.renderGallery());

    // Masters Filter button
    const filterMastersBtn = document.getElementById('filterMastersBtn');
    if (filterMastersBtn) {
      filterMastersBtn.addEventListener('click', () => {
        this.onlyMasters = !this.onlyMasters;
        filterMastersBtn.style.background = this.onlyMasters ? '#059669' : '';
        filterMastersBtn.style.color = this.onlyMasters ? '#fff' : '';
        this.renderGallery();
      });
    }

    // Select Masters button
    const selectMastersBtn = document.getElementById('selectMastersBtn');
    if (selectMastersBtn) {
      selectMastersBtn.addEventListener('click', () => {
        const visibleMasters = this.getFilteredImages().filter(img => this.isMasterImage(img));
        const allMastersSelected = visibleMasters.length > 0 && visibleMasters.every(img => this.selectedIds.has(img.id));
        if (allMastersSelected) {
          visibleMasters.forEach(img => this.selectedIds.delete(img.id));
        } else {
          visibleMasters.forEach(img => this.selectedIds.add(img.id));
        }
        this.updateSelectionUI();
      });
    }

    // Select All
    this.selectAllCheckbox.addEventListener('change', (e) => {
      const visible = this.getFilteredImages();
      if (e.target.checked) {
        visible.forEach(img => this.selectedIds.add(img.id));
      } else {
        visible.forEach(img => this.selectedIds.delete(img.id));
      }
      this.updateSelectionUI();
    });

    // Batch ZIP Download
    this.downloadZipBtn.addEventListener('click', () => this.downloadSelectedZip());

    // Presets
    document.querySelectorAll('.preset-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        const preset = e.target.getAttribute('data-preset');
        this.loadPreset(preset);
      });
    });

    if (this.quickSampleBtn) {
      this.quickSampleBtn.addEventListener('click', () => this.loadPreset('nature'));
    }

    // Lightbox controls
    this.closeLightboxBtn.addEventListener('click', () => this.lightboxModal.close());
    this.lightboxModal.addEventListener('click', (e) => {
      if (e.target === this.lightboxModal) this.lightboxModal.close();
    });

    this.copyUrlBtn.addEventListener('click', () => {
      if (this.metaFullUrl.value) {
        navigator.clipboard.writeText(this.metaFullUrl.value);
        this.copyUrlBtn.textContent = 'Copied!';
        setTimeout(() => { this.copyUrlBtn.textContent = 'Copy Source URL'; }, 1500);
      }
    });

    // Links Modal listeners
    if (this.openLinksModalBtn && this.linksModal) {
      this.openLinksModalBtn.addEventListener('click', () => this.openLinksModal());
      if (this.closeLinksModalBtn) {
        this.closeLinksModalBtn.addEventListener('click', () => this.linksModal.close());
      }
      this.linksModal.addEventListener('click', (e) => {
        if (e.target === this.linksModal) this.linksModal.close();
      });

      if (this.showDirectLinksBtn) {
        this.showDirectLinksBtn.addEventListener('click', () => {
          this.linksViewMode = 'direct';
          this.showDirectLinksBtn.className = 'btn-primary';
          this.showWebpageLinksBtn.className = 'btn-secondary';
          this.updateLinksModalContent();
        });
      }

      if (this.showWebpageLinksBtn) {
        this.showWebpageLinksBtn.addEventListener('click', () => {
          this.linksViewMode = 'webpage';
          this.showWebpageLinksBtn.className = 'btn-primary';
          this.showDirectLinksBtn.className = 'btn-secondary';
          this.updateLinksModalContent();
        });
      }

      if (this.copyAllLinksBtn) {
        this.copyAllLinksBtn.addEventListener('click', () => {
          if (this.linksTextarea && this.linksTextarea.value) {
            navigator.clipboard.writeText(this.linksTextarea.value);
            const orig = this.copyAllLinksBtn.textContent;
            this.copyAllLinksBtn.textContent = 'Copied!';
            setTimeout(() => { this.copyAllLinksBtn.textContent = orig; }, 1500);
          }
        });
      }

      if (this.downloadLinksTxtBtn) {
        this.downloadLinksTxtBtn.addEventListener('click', () => this.downloadLinksFile('txt'));
      }
      if (this.downloadLinksCsvBtn) {
        this.downloadLinksCsvBtn.addEventListener('click', () => this.downloadLinksFile('csv'));
      }
      if (this.downloadLinksJsonBtn) {
        this.downloadLinksJsonBtn.addEventListener('click', () => this.downloadLinksFile('json'));
      }
      if (this.downloadLinksZipBtn) {
        this.downloadLinksZipBtn.addEventListener('click', () => {
          this.downloadSelectedZip();
        });
      }
    }

    // Global keyboard support
    window.addEventListener('keydown', (e) => {
      if (this.lightboxModal && this.lightboxModal.open) {
        if (e.key === 'Escape') this.lightboxModal.close();
        if (e.key === 'ArrowRight') this.navigateLightbox(1);
        if (e.key === 'ArrowLeft') this.navigateLightbox(-1);
      }
      if (this.linksModal && this.linksModal.open) {
        if (e.key === 'Escape') this.linksModal.close();
      }
    });
  }

  initTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  async scrapeUrl(url) {
    if (!url) return;
    this.lastUrl = url;
    this.setLoading(true);

    try {
      const followLinked = this.followLinkedCheckbox ? this.followLinkedCheckbox.checked : true;
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, follow_linked_pages: followLinked })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to scrape webpage');
      }

      this.images = data.images || [];
      this.selectedIds.clear();

      this.resultPageTitle.textContent = data.page_title || 'Scraped Gallery';
      this.statTotalCount.textContent = `${data.stats.total_found} images found`;
      this.statUnshrunkCount.textContent = `${data.stats.unshrunk_count} upgraded to master full-res`;
      this.statUrlText.textContent = data.url;

      this.emptyState.classList.add('hidden');
      this.resultsSection.classList.remove('hidden');

      this.renderGallery();
      this.updateSelectionUI();
    } catch (err) {
      alert(`Scraping error: ${err.message}`);
    } finally {
      this.setLoading(false);
    }
  }

  isMasterImage(img) {
    if (img.is_unshrunk) return true;
    if (img.resolution_tier === '4k' || img.resolution_tier === 'hd') return true;
    if (img.width && img.height && (img.width >= 1000 || img.height >= 1000)) return true;
    return Boolean(img.is_unshrunk || (img.resolution_tier && img.resolution_tier !== 'small'));
  }

  getFilteredImages() {
    const format = this.formatFilter.value;
    const resolution = this.resolutionFilter.value;

    return this.images.filter(img => {
      if (format !== 'all' && img.format !== format) return false;
      if (resolution === 'masters' && !this.isMasterImage(img)) return false;
      if (resolution !== 'all' && resolution !== 'masters' && img.resolution_tier !== resolution) return false;
      if (this.onlyMasters && !this.isMasterImage(img)) return false;
      return true;
    });
  }

  renderGallery() {
    const filtered = this.getFilteredImages();
    this.imageGrid.innerHTML = '';

    if (filtered.length === 0) {
      this.imageGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
          No images match the current filter criteria.
        </div>
      `;
      return;
    }

    filtered.forEach((img, index) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      const isSelected = this.selectedIds.has(img.id);

      const viewerUrl = `/view-image?url=${encodeURIComponent(img.full_url)}&title=${encodeURIComponent(img.filename)}&sourcePage=${encodeURIComponent(this.lastUrl || '')}&linkedPage=${encodeURIComponent(img.linked_page_url || '')}`;

      card.innerHTML = `
        <div class="image-thumbnail-wrapper" data-img-id="${img.id}">
          <img src="${img.thumbnail_url}" alt="${img.alt_text}" class="card-img" loading="lazy" referrerpolicy="no-referrer">
          <div class="card-select-overlay" onclick="event.stopPropagation()">
            <input type="checkbox" class="img-select-check" data-id="${img.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${img.filename}">
          </div>
          ${img.is_unshrunk ? `<span class="card-badge-overlay">Full-Res Master</span>` : ''}
          ${img.linked_page_url ? `<span class="card-badge-overlay" style="left: 0.5rem; right: auto; background: rgba(59,130,246,0.9);">Linked Subpage</span>` : ''}
        </div>
        <div class="card-content">
          <div class="card-filename" title="${img.filename}">${img.filename}</div>
          <div class="card-meta-line">
            <span class="font-mono uppercase">${img.format}</span>
            <span>${img.width && img.height ? `${img.width}×${img.height}` : (img.resolution_tier || 'Full Source')}</span>
          </div>
          <div class="card-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem;">
            <button type="button" class="btn-card-inspect" data-idx="${index}">Inspect</button>
            <a href="${viewerUrl}" target="_blank" rel="noopener" class="btn-card-inspect" style="text-align: center; text-decoration: none; background: var(--bg-hover);">Full Webpage ↗</a>
            <a href="${img.full_url}" download="${img.filename}" class="btn-card-download" style="grid-column: 1 / -1;" target="_blank" rel="noopener">Download File</a>
          </div>
        </div>
      `;

      // Click card or inspect opens lightbox
      card.querySelector('.image-thumbnail-wrapper').addEventListener('click', () => this.openLightbox(img));
      card.querySelector('.btn-card-inspect').addEventListener('click', () => this.openLightbox(img));

      // Checkbox handler
      const checkbox = card.querySelector('.img-select-check');
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.selectedIds.add(img.id);
        } else {
          this.selectedIds.delete(img.id);
        }
        this.updateSelectionUI();
      });

      this.imageGrid.appendChild(card);
    });
  }

  updateSelectionUI() {
    const count = this.selectedIds.size;
    this.selectedCountText.textContent = `${count} selected`;
    this.downloadZipBtn.disabled = count === 0;

    const visible = this.getFilteredImages();
    const allVisibleSelected = visible.length > 0 && visible.every(img => this.selectedIds.has(img.id));
    this.selectAllCheckbox.checked = allVisibleSelected;
  }

  openLightbox(image) {
    this.currentImage = image;
    this.lightboxTitle.textContent = image.filename;
    this.lightboxImg.src = image.full_url;
    this.metaFormat.textContent = image.format;
    this.metaMethod.textContent = image.unshrink_method || 'Direct Master URL';
    this.metaFullUrl.value = image.full_url;
    this.downloadSingleBtn.href = image.full_url;
    this.downloadSingleBtn.setAttribute('download', image.filename);

    const viewerUrl = `/view-image?url=${encodeURIComponent(image.full_url)}&title=${encodeURIComponent(image.filename)}&sourcePage=${encodeURIComponent(this.lastUrl || '')}&linkedPage=${encodeURIComponent(image.linked_page_url || '')}`;
    if (this.openNewWebpageBtn) {
      this.openNewWebpageBtn.href = viewerUrl;
    }

    if (this.metaLinkedPageBlock && this.metaLinkedPageLink) {
      if (image.linked_page_url) {
        this.metaLinkedPageBlock.style.display = 'block';
        this.metaLinkedPageLink.href = image.linked_page_url;
        this.metaLinkedPageLink.textContent = image.linked_page_url;
      } else {
        this.metaLinkedPageBlock.style.display = 'none';
      }
    }

    if (image.is_unshrunk) {
      this.lightboxBadge.style.display = 'inline-block';
      this.lightboxBadge.textContent = 'Upgraded to Full-Res Master';
    } else {
      this.lightboxBadge.style.display = 'none';
    }

    this.metaDimensions.textContent = image.width && image.height ? `${image.width} × ${image.height} px` : 'Probing image...';
    this.metaTier.textContent = image.resolution_tier ? image.resolution_tier.toUpperCase() : 'Full-Res';

    // Probe actual dimensions
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.onload = () => {
      this.metaDimensions.textContent = `${probe.naturalWidth} × ${probe.naturalHeight} px`;
    };
    probe.src = image.full_url;

    this.lightboxModal.showModal();
  }

  navigateLightbox(direction) {
    if (!this.currentImage) return;
    const filtered = this.getFilteredImages();
    const currentIdx = filtered.findIndex(img => img.id === this.currentImage.id);
    if (currentIdx === -1) return;

    let nextIdx = currentIdx + direction;
    if (nextIdx < 0) nextIdx = filtered.length - 1;
    if (nextIdx >= filtered.length) nextIdx = 0;

    this.openLightbox(filtered[nextIdx]);
  }

  async downloadSelectedZip() {
    const selected = this.images.filter(img => this.selectedIds.has(img.id));
    if (selected.length === 0) return;

    const originalText = this.downloadZipBtn.innerHTML;
    this.downloadZipBtn.disabled = true;
    this.downloadZipBtn.innerHTML = `<span>Packing ${selected.length} images...</span>`;

    try {
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: selected.map(img => ({ url: img.full_url, filename: img.filename }))
        })
      });

      if (!response.ok) throw new Error('Failed to generate ZIP archive');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `scraped_images_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert(`Batch download failed: ${err.message}`);
    } finally {
      this.downloadZipBtn.disabled = false;
      this.downloadZipBtn.innerHTML = originalText;
    }
  }

  loadPreset(presetType) {
    const presets = {
      nature: 'https://photography-showcase.org/galleries/yosemite-wildlife',
      architecture: 'https://arch-design-review.com/exhibits/brutalism-and-glass',
      ecommerce: 'https://nordic-craft-supplies.com/collections/ceramics-and-tools'
    };
    const targetUrl = presets[presetType] || presets.nature;
    this.urlInput.value = targetUrl;
    this.scrapeUrl(targetUrl);
  }

  setLoading(isLoading) {
    const btnText = this.scrapeBtn.querySelector('.btn-text');
    const spinner = this.scrapeBtn.querySelector('.spinner');
    this.scrapeBtn.disabled = isLoading;
    if (isLoading) {
      if (btnText) btnText.textContent = 'Extracting Images...';
      if (spinner) spinner.classList.remove('hidden');
    } else {
      if (btnText) btnText.textContent = 'Extract Images';
      if (spinner) spinner.classList.add('hidden');
    }
  }

  openLinksModal() {
    if (!this.images || this.images.length === 0) {
      alert('Please scrape a webpage first to extract image links.');
      return;
    }
    this.linksViewMode = 'direct';
    if (this.showDirectLinksBtn) this.showDirectLinksBtn.className = 'btn-primary';
    if (this.showWebpageLinksBtn) this.showWebpageLinksBtn.className = 'btn-secondary';
    this.updateLinksModalContent();
    if (this.linksModal && typeof this.linksModal.showModal === 'function') {
      this.linksModal.showModal();
    }
  }

  updateLinksModalContent() {
    if (!this.linksTextarea) return;
    const list = this.images.map(img => {
      if (this.linksViewMode === 'webpage') {
        return img.linked_page_url || img.full_url;
      }
      return img.full_url;
    }).filter(Boolean);

    this.linksTextarea.value = list.join('\n');
    if (this.linksCountStatus) {
      this.linksCountStatus.textContent = `${list.length} master link${list.length === 1 ? '' : 's'} available (${this.linksViewMode === 'direct' ? 'Direct CDN' : 'Webpage'})`;
    }
  }

  downloadLinksFile(format) {
    if (!this.images || this.images.length === 0) return;
    let content = '';
    const filename = `master_image_links.${format}`;
    let mime = 'text/plain';

    if (format === 'txt') {
      content = this.images.map(img => img.full_url).filter(Boolean).join('\n');
    } else if (format === 'csv') {
      mime = 'text/csv';
      const rows = ['Index,Filename,DirectMasterUrl,WebpageUrl'];
      this.images.forEach((img, i) => {
        rows.push(`${i+1},"${(img.filename||'').replace(/"/g, '""')}","${(img.full_url||'').replace(/"/g, '""')}","${(img.linked_page_url||'').replace(/"/g, '""')}"`);
      });
      content = rows.join('\n');
    } else if (format === 'json') {
      mime = 'application/json';
      content = JSON.stringify(this.images.map((img, i) => ({
        index: i + 1,
        filename: img.filename,
        directMasterUrl: img.full_url,
        webpageUrl: img.linked_page_url || null,
        width: img.width,
        height: img.height,
        resolutionTier: img.resolution_tier,
        isUnshrunk: img.is_unshrunk
      })), null, 2);
    }

    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Global invocation helper
window.handleScrape = () => {
  const url = document.getElementById('urlInput').value.trim();
  if (window.appInstance && url) {
    window.appInstance.scrapeUrl(url);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.appInstance = new FullResApp();
});
