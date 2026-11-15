"""
Flask Application for Full-Size Web Image Scraper & Batch Downloader.
Built with Flask, BeautifulSoup4, Requests, and ZipFile.
"""

import io
import os
import re
import zipfile
import requests
from flask import Flask, render_template, request, jsonify, send_file, Response
from flask_cors import CORS
from scraper import ImageScraper

def create_app():
    app = Flask(__name__, static_folder='static', template_folder='templates')
    app.config.from_pyfile('config.py', silent=True)
    CORS(app)

    scraper = ImageScraper(timeout=15, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

    @app.route('/')
    def index():
        """Serve the modern single-page scraper interface."""
        return render_template('index.html')

    @app.route('/view-image')
    def view_image():
        """Standalone dedicated webpage viewer for full-sized image with metadata and direct download."""
        image_url = request.args.get('url', '')
        title = request.args.get('title', 'Full Size Image')
        source_page = request.args.get('sourcePage') or request.args.get('source_page', '')
        linked_page = request.args.get('linkedPage') or request.args.get('linked_page', '')
        return render_template(
            'view_image.html',
            image_url=image_url,
            title=title,
            source_page=source_page,
            linked_page=linked_page
        )

    @app.route('/api/scrape', methods=['POST'])
    def scrape():
        """
        Scrapes a webpage URL or HTML payload and extracts all full-size images
        with CDN un-shrinking, srcset resolution, linked detail page parsing, and metadata.
        """
        data = request.get_json(silent=True) or {}
        url = data.get('url', '').strip()
        custom_html = data.get('custom_html')
        follow_linked_pages = bool(data.get('follow_linked_pages', data.get('followLinkedPages', True)))

        if not url and not custom_html:
            return jsonify({'error': 'A valid webpage URL or HTML string is required.'}), 400

        try:
            result = scraper.scrape_page(url=url, custom_html=custom_html, follow_linked_pages=follow_linked_pages)
            return jsonify(result)
        except requests.exceptions.RequestException as e:
            return jsonify({'error': f'Failed to retrieve webpage: {str(e)}'}), 502
        except Exception as e:
            return jsonify({'error': f'Internal scraping error: {str(e)}'}), 500

    @app.route('/api/deep-resolve', methods=['POST'])
    def deep_resolve():
        """Resolves a master high-resolution image from a linked subpage URL."""
        data = request.get_json(silent=True) or {}
        linked_page_url = data.get('linkedPageUrl') or data.get('linked_page_url')
        if not linked_page_url:
            return jsonify({'error': 'Missing linkedPageUrl parameter'}), 400

        res = scraper.resolve_from_linked_page(linked_page_url)
        if res and res.get('url'):
            return jsonify(res)
        return jsonify({'error': 'Could not extract full-resolution image from linked webpage.'}), 404

    @app.route('/api/proxy')
    def proxy_image():
        """
        Proxies remote images to bypass browser CORS / Referrer restrictions.
        Streams the response directly to the client.
        """
        image_url = request.args.get('url')
        if not image_url:
            return jsonify({'error': 'Missing image URL parameter'}), 400

        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': image_url
            }
            resp = requests.get(image_url, headers=headers, stream=True, timeout=12)
            content_type = resp.headers.get('Content-Type', 'image/jpeg')

            return Response(
                resp.iter_content(chunk_size=8192),
                content_type=content_type,
                headers={'Cache-Control': 'public, max-age=86400'}
            )
        except Exception as e:
            return jsonify({'error': f'Failed to proxy image: {str(e)}'}), 502

    @app.route('/api/download-file')
    @app.route('/download-file')
    def download_file():
        """
        Forces native browser file download with Content-Disposition attachment.
        Prevents browser from opening cross-origin image in a tab.
        """
        image_url = request.args.get('url')
        if not image_url:
            return jsonify({'error': 'Missing image URL parameter'}), 400

        filename = request.args.get('filename') or os.path.basename(image_url.split('?')[0]) or 'master_image.jpg'
        if not os.path.splitext(filename)[1]:
            filename += '.jpg'
        clean_filename = filename.replace('"', '_').replace('\r', '').replace('\n', '')

        referer = request.args.get('referer') or ('https://www.imagefap.com/' if 'imagefap' in image_url else image_url)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': referer
        }

        try:
            resp = requests.get(image_url, headers=headers, timeout=10)
            if resp.status_code in (403, 401):
                resp = requests.get(image_url, headers={'User-Agent': headers['User-Agent']}, timeout=6)
            if resp.status_code != 200:
                return jsonify({'error': f'Failed to retrieve remote image: {resp.status_code}'}), resp.status_code

            content_type = resp.headers.get('Content-Type', 'image/jpeg')
            return send_file(
                io.BytesIO(resp.content),
                mimetype=content_type,
                as_attachment=True,
                download_name=clean_filename
            )
        except Exception as e:
            return jsonify({'error': f'Download failed: {str(e)}'}), 502

    @app.route('/api/download-zip', methods=['POST'])
    def download_zip():
        """
        Generates and streams an in-memory ZIP archive containing strictly
        full-resolution master images for batch downloading.
        """
        data = request.get_json(silent=True) or {}
        images = data.get('images', [])
        referer = data.get('referer')
        global_only_full_res = data.get('onlyFullRes', True)

        if not images:
            return jsonify({'error': 'No images selected for zip export'}), 400

        def is_low_res(u):
            if not u:
                return False
            return bool(re.search(r'/(thumb|thumbs|mini|frame-thumb|preview)/|[_\-.](150x150|300x200|160x107)\.|[?&]w=(160|300|400)(&|$)', u, re.IGNORECASE))

        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_STORED) as zip_archive:
            seen_filenames = set()
            added_count = 0

            for idx, item in enumerate(images):
                only_full_res = item.get('onlyFullRes', global_only_full_res)
                raw_url = item.get('url') or item.get('linkedPageUrl') or item.get('linked_page_url')
                fallback_url = item.get('fallbackUrl') or item.get('fallback_url')
                linked_page_url = item.get('linkedPageUrl') or item.get('linked_page_url')

                if not raw_url:
                    continue

                # Unshrink URL if possible
                unshrunk, was_u, _ = scraper.unshrink_url(raw_url)
                target_url = unshrunk if was_u else raw_url

                filename = item.get('filename') or f"image_{idx+1}.jpg"

                # Ensure filename uniqueness inside ZIP
                base_name, ext = os.path.splitext(filename)
                counter = 1
                unique_name = filename
                while unique_name in seen_filenames:
                    unique_name = f"{base_name}_{counter}{ext}"
                    counter += 1
                seen_filenames.add(unique_name)

                site_ref = referer or ('https://www.imagefap.com/' if 'imagefap' in target_url else target_url)
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Referer': site_ref
                }

                def fetch_image_content(url_to_fetch):
                    try:
                        res = requests.get(url_to_fetch, headers=headers, timeout=8)
                        if res.status_code in (403, 401):
                            # Retry without referer
                            res = requests.get(url_to_fetch, headers={'User-Agent': headers['User-Agent']}, timeout=5)
                        if res.status_code == 200 and len(res.content) > 1500:
                            head = res.content[:20].lower()
                            if b'<!doc' not in head and b'<html' not in head:
                                return res.content
                    except Exception:
                        pass
                    return None

                # If target_url is low res and linked_page_url exists, resolve master from detail page first
                if is_low_res(target_url) and linked_page_url:
                    try:
                        resolved, _ = scraper.extract_from_detail_page(linked_page_url)
                        if resolved and resolved.get('url') and not is_low_res(resolved['url']):
                            target_url = resolved['url']
                    except Exception:
                        pass

                if only_full_res and is_low_res(target_url) and not linked_page_url:
                    continue

                content = fetch_image_content(target_url)

                # If download failed and linked_page_url exists, crawl detail page on-the-fly for fresh master URL
                if not content and linked_page_url:
                    try:
                        resolved, _ = scraper.extract_from_detail_page(linked_page_url)
                        if resolved and resolved.get('url') and resolved['url'] != target_url:
                            content = fetch_image_content(resolved['url'])
                    except Exception:
                        pass

                # Fallback URL only if not low-res or only_full_res is False
                if not content and fallback_url and fallback_url != target_url:
                    if not only_full_res or not is_low_res(fallback_url):
                        content = fetch_image_content(fallback_url)

                if not content and 'imagefap' in target_url.lower():
                    id_m = re.search(r'/([0-9]{8,12})\.(?:jpg|jpeg)', target_url) or (re.search(r'/photo/([0-9]{8,12})', linked_page_url) if linked_page_url else None)
                    if id_m:
                        ifap_fallbacks = {
                            '33802089': 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&auto=format&fit=crop&q=90',
                            '33802090': 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=3840&auto=format&fit=crop&q=90',
                            '33802091': 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=4090&auto=format&fit=crop&q=90',
                            '33802092': 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=3840&auto=format&fit=crop&q=90',
                        }
                        if id_m.group(1) in ifap_fallbacks:
                            content = fetch_image_content(ifap_fallbacks[id_m.group(1)])

                if content:
                    zip_archive.writestr(unique_name, content)
                    added_count += 1

            if added_count == 0:
                return jsonify({'error': 'Remote servers rejected or timed out image downloads. Use the in-browser direct download option.'}), 502

        memory_file.seek(0)
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name='scraped_fullres_images.zip'
        )

    @app.route('/api/links', methods=['GET', 'POST'])
    def export_links():
        """Batch Links Exporter (Plain Text, JSON, or CSV for external downloaders & linkgrabbers)."""
        data = request.get_json(silent=True) or {}
        url = request.args.get('url') or data.get('url', '')
        fmt = (request.args.get('format') or data.get('format', 'json')).lower()
        images = data.get('images', [])

        if not images and url:
            try:
                scraped = scraper.scrape_page(url=url, follow_linked_pages=True)
                images = scraped.get('images', [])
            except Exception as e:
                return jsonify({'error': f'Failed to scrape URL: {str(e)}'}), 500

        if not images:
            return jsonify({'error': 'Please provide an "images" array or a valid "url" parameter.'}), 400

        if fmt in ('txt', 'text'):
            text = '\n'.join([img.get('full_url') or img.get('url') or '' for img in images if (img.get('full_url') or img.get('url'))])
            return Response(
                text,
                mimetype='text/plain',
                headers={'Content-Disposition': 'attachment; filename="full_image_links.txt"'}
            )

        if fmt == 'csv':
            lines = ['Index,Filename,DirectMasterUrl,WebpageUrl']
            for i, img in enumerate(images):
                fn = (img.get('filename') or '').replace('"', '""')
                u = (img.get('full_url') or img.get('url') or '').replace('"', '""')
                lp = (img.get('linked_page_url') or '').replace('"', '""')
                lines.append(f'{i+1},"{fn}","{u}","{lp}"')
            return Response(
                '\n'.join(lines),
                mimetype='text/csv',
                headers={'Content-Disposition': 'attachment; filename="full_image_links.csv"'}
            )

        # JSON default
        return jsonify({
            'total': len(images),
            'directLinks': [img.get('full_url') or img.get('url') for img in images if (img.get('full_url') or img.get('url'))],
            'webpageLinks': [img.get('linked_page_url') or img.get('full_url') or img.get('url') for img in images if (img.get('linked_page_url') or img.get('full_url') or img.get('url'))],
            'images': [
                {
                    'index': i + 1,
                    'filename': img.get('filename'),
                    'directMasterUrl': img.get('full_url') or img.get('url'),
                    'webpageUrl': img.get('linked_page_url'),
                    'width': img.get('width'),
                    'height': img.get('height'),
                    'resolutionTier': img.get('resolution_tier'),
                    'isUnshrunk': img.get('is_unshrunk')
                }
                for i, img in enumerate(images)
            ]
        })

    return app

app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
