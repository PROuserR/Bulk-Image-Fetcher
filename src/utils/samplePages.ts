/**
 * Sample showcase pages for instant testing, verification, and demo exploration.
 * Features real patterns: WordPress thumbnails, Wikimedia Commons, Unsplash srcset,
 * lazy-loaded data-original, and lightbox <a> anchors.
 */

export interface SamplePreset {
  id: string;
  name: string;
  category: string;
  url: string;
  description: string;
  imageCount: number;
  html: string;
}

export const SAMPLE_PRESETS: SamplePreset[] = [
  {
    id: 'nature_wildlife',
    name: 'National Parks & Wildlife Photo Gallery',
    category: 'Nature & Landscape',
    url: 'https://photography-showcase.org/galleries/yosemite-wildlife',
    description: 'WordPress & srcset structure with 300x200 thumbnails linking to 4K originals.',
    imageCount: 8,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Yosemite Valley & Alpine Wildlife Photography 2026</title>
  <meta property="og:image" content="https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=1200&fit=crop">
</head>
<body>
  <header><h1>Yosemite Valley & Alpine Wildlife</h1></header>
  <main class="photo-gallery">
    <!-- Image 1: Lightbox anchor wrapping preview -->
    <figure class="gallery-item">
      <a href="https://images.unsplash.com/photo-1426604966848-d7adac402bff?q=100&auto=format" class="lightbox-link">
        <img src="https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=400&fit=crop&q=60" alt="Half Dome at Sunrise with Misty Clouds" width="400" height="267">
      </a>
      <figcaption>Half Dome at Sunrise (Full Resolution Master Available)</figcaption>
    </figure>

    <!-- Image 2: WordPress-style dimensions in filename -->
    <figure class="gallery-item">
      <img src="https://images.unsplash.com/photo-1472214103451-9374bd1c798e-300x200.jpg" 
           data-original="https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=100" 
           alt="Emerald Lake Alpine Valley Panorama" width="300" height="200">
      <figcaption>Emerald Lake Valley</figcaption>
    </figure>

    <!-- Image 3: Responsive Picture with srcset descriptors -->
    <picture>
      <source media="(min-width: 1200px)" srcset="https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=2560&q=90 2560w, https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&q=85 1920w">
      <source media="(min-width: 768px)" srcset="https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=75 800w">
      <img src="https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=320&q=60" alt="Misty Pine Forest Canopy at Twilight" width="320">
    </picture>

    <!-- Image 4: High-res wildlife with lightbox link -->
    <figure class="gallery-item">
      <a href="https://images.unsplash.com/photo-1530595467537-0b5996c41f2d?q=100&auto=format">
        <img src="https://images.unsplash.com/photo-1530595467537-0b5996c41f2d?w=400&fit=crop" alt="Alaskan Coastal Brown Bear in River" width="400">
      </a>
    </figure>

    <!-- Image 5: Lazy load data-high-res -->
    <figure class="gallery-item">
      <img src="https://images.unsplash.com/photo-1448375240586-882707db888b?w=300&fit=crop" 
           data-high-res="https://images.unsplash.com/photo-1448375240586-882707db888b?w=3840&q=100" 
           alt="Redwood Giants Morning Sunbeams" width="300">
    </figure>

    <!-- Image 6: Alpine Lake Reflection -->
    <figure class="gallery-item">
      <a href="https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=3840&q=95">
        <img src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=450&fit=crop" alt="Crater Lake Crystal Reflection at Dusk" width="450">
      </a>
    </figure>

    <!-- Image 7: High-Res Wild Elk in Meadow -->
    <figure class="gallery-item">
      <img src="https://images.unsplash.com/photo-1437622368342-7a3d73a34c8f?w=300&fit=crop" 
           data-zoom-image="https://images.unsplash.com/photo-1437622368342-7a3d73a34c8f?w=3200&q=95" 
           alt="Majestic Bull Elk in Morning Mist" width="300">
    </figure>

    <!-- Image 8: Starry Night Canyon -->
    <figure class="gallery-item">
      <a href="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=2560&q=90">
        <img src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=350&fit=crop" alt="Tropical Coastline Golden Sunset" width="350">
      </a>
    </figure>

    <!-- Image 9: Wikimedia Commons thumb unshrinking -->
    <figure class="gallery-item">
      <a href="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Ours_brun_parc_national_de_Katmai.jpg/320px-Ours_brun_parc_national_de_Katmai.jpg">
        <img src="https://images.unsplash.com/photo-1530595467537-0b5996c41f2d?w=320&fit=crop" alt="Alaskan Coastal Brown Bear in Katmai" width="320">
      </a>
    </figure>
  </main>
</body>
</html>`,
  },
  {
    id: 'architectural_showcase',
    name: 'Metropolitan Architecture & Modern Spaces',
    category: 'Architecture',
    url: 'https://arch-design-review.com/exhibits/brutalism-and-glass',
    description: 'Complex srcset grids with high-density 2x/3x retina descriptors and Unsplash CDN.',
    imageCount: 6,
    html: `<!DOCTYPE html>
<html>
<head>
  <title>Minimalist Metropolitan Concrete & Glass Architecture</title>
  <meta property="og:image" content="https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1600&q=90">
</head>
<body>
  <div class="grid">
    <img src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&fit=crop" 
         srcset="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=2800&q=90 2800w, https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1400&q=80 1400w" 
         alt="Financial Tower Glass Facade Upward Perspective" width="400">

    <a href="https://images.unsplash.com/photo-1513694203232-719a280e022f?w=3200&q=100">
      <img src="https://images.unsplash.com/photo-1513694203232-719a280e022f?w=400&fit=crop" alt="Curved Spiral Concrete Stairwell in Berlin" width="400">
    </a>

    <img src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=380&fit=crop" 
         data-original="https://images.unsplash.com/photo-1497366216548-37526070297c?w=3840&q=95" 
         alt="Modern Scandinavian Open Workspace Interior" width="380">

    <img src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=420&fit=crop" 
         srcset="https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=2400&q=90 2400w, https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1200&q=80 1200w" 
         alt="Geometric Concrete Pavilion Structural Ribs" width="420">

    <a href="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=3600&q=95">
      <img src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=350&fit=crop" alt="Contemporary Luxury Villa Exterior Pool" width="350">
    </a>

    <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&fit=crop" 
         data-high-res="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=3200&q=100" 
         alt="Minimalist Living Pavilion at Twilight" width="400">
  </div>
</body>
</html>`,
  },
  {
    id: 'ecommerce_store',
    name: 'Artisan Hardware & Scandinavian Goods',
    category: 'E-Commerce / Shopify',
    url: 'https://nordic-craft-supplies.com/collections/ceramics-and-tools',
    description: 'Product catalog thumbnails paired with data-original, data-zoom-image, and lightbox high-res masters.',
    imageCount: 6,
    html: `<!DOCTYPE html>
<html>
<head>
  <title>Handcrafted Ceramic Tableware & Precision Tools</title>
</head>
<body>
  <div class="product-grid">
    <div class="product-card">
      <a href="https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=3000&q=95">
        <img src="https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=300&fit=crop" alt="Artisanal Stoneware Pour-Over Carafe" width="300">
      </a>
      <h3>Pour-Over Carafe</h3>
    </div>

    <div class="product-card">
      <img src="https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=300&fit=crop" 
           data-original="https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=2800&q=95" 
           alt="Hand-Turned Oak Wood Tableware Plate" width="300">
      <h3>Handmade Oak Plate</h3>
    </div>

    <div class="product-card">
      <a href="https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=2600&q=95">
        <img src="https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=300&fit=crop" alt="Analog Instant Film Camera Body" width="300">
      </a>
      <h3>Analog Film Camera</h3>
    </div>

    <div class="product-card">
      <img src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&fit=crop" 
           data-zoom-image="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=3200&q=95" 
           alt="Studio Over-Ear Audio Monitor Headphones" width="300">
      <h3>Studio Headphones</h3>
    </div>

    <div class="product-card">
      <a href="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=2500&q=95">
        <img src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&fit=crop" alt="Minimalist Chronograph Wristwatch White Dial" width="300">
      </a>
      <h3>Minimal Chronograph</h3>
    </div>

    <div class="product-card">
      <img src="https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=300&fit=crop" 
           data-high-res="https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=3000&q=90" 
           alt="Smart Fitness Watch Matte Black" width="300">
      <h3>Fitness Smartwatch</h3>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: 'imagefap_gallery',
    name: 'Hazel Moore - The Legend Of Biggy Creek (Gallery Showcase)',
    category: 'Linked Subpage Gallery',
    url: 'preset:imagefap_gallery',
    description: 'Photo gallery with preview thumbnails linked to subpages, resolved to 4090×2727 master full-res originals.',
    imageCount: 8,
    html: `<!DOCTYPE html>
<html>
<head>
  <title>Hazel Moore The Legend Of Biggy Creek</title>
</head>
<body>
  <table>
    <tr>
      <td id="1109704572" align="center" height="230" valign="top">
        <a name="1109704572" href="/photo/1109704572/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1534447677768-be436bb09401?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="1109704572" title="Hazel Moore The Legend Of Biggy Creek - 001.jpg">
          <img src="https://images.unsplash.com/photo-1534447677768-be436bb09401?w=160&amp;h=107&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 001.jpg" width="160" height="107">
        </a>
      </td>
      <td id="646270480" align="center" height="230" valign="top">
        <a name="646270480" href="/photo/646270480/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="3840x2160" imageid="646270480" title="Hazel Moore The Legend Of Biggy Creek - 002.jpg">
          <img src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=160&amp;h=90&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 002.jpg" width="160" height="90">
        </a>
      </td>
      <td id="964823747" align="center" height="230" valign="top">
        <a name="964823747" href="/photo/964823747/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1511497584788-87676104235f?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="964823747" title="Hazel Moore The Legend Of Biggy Creek - 003.jpg">
          <img src="https://images.unsplash.com/photo-1511497584788-87676104235f?w=160&amp;h=107&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 003.jpg" width="160" height="107">
        </a>
      </td>
      <td id="1815511841" align="center" height="230" valign="top">
        <a name="1815511841" href="/photo/1815511841/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="1815511841" title="Hazel Moore The Legend Of Biggy Creek - 004.jpg">
          <img src="https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=160&amp;h=107&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 004.jpg" width="160" height="107">
        </a>
      </td>
    </tr>
    <tr>
      <td id="584048998" align="center" height="230" valign="top">
        <a name="584048998" href="/photo/584048998/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="584048998" title="Hazel Moore The Legend Of Biggy Creek - 005.jpg">
          <img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=160&amp;h=107&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 005.jpg" width="160" height="107">
        </a>
      </td>
      <td id="1409774483" align="center" height="230" valign="top">
        <a name="1409774483" href="/photo/1409774483/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="1409774483" title="Hazel Moore The Legend Of Biggy Creek - 006.jpg">
          <img src="https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=160&amp;h=107&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 006.jpg" width="160" height="107">
        </a>
      </td>
      <td id="1216356569" align="center" height="230" valign="top">
        <a name="1216356569" href="/photo/1216356569/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="1216356569" title="Hazel Moore The Legend Of Biggy Creek - 007.jpg">
          <img src="https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=160&amp;h=107&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 007.jpg" width="160" height="107">
        </a>
      </td>
      <td id="287194059" align="center" height="230" valign="top">
        <a name="287194059" href="/photo/287194059/?pgid=&amp;gid=14238993&amp;page=0" 
           original="https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="287194059" title="Hazel Moore The Legend Of Biggy Creek - 008.jpg">
          <img src="https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=160&amp;h=107&amp;fit=crop" alt="Hazel Moore The Legend Of Biggy Creek - 008.jpg" width="160" height="107">
        </a>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
  {
    id: 'imagefap_jessie_rogers',
    name: 'Jessie Rogers & Lexington Steele (Gallery 13643086)',
    category: 'Direct CDN Master Gallery',
    url: 'https://www.imagefap.com/pictures/13643086/Jessie%20Rogers%20and%20Lexington%20Steele%20Anal?gid=13643086&view=2',
    description: 'Gallery 13643086 with 8-digit photo 33802089, master CDN direct download link, and detail subpage.',
    imageCount: 4,
    html: `<!DOCTYPE html>
<html>
<head>
  <title>Jessie Rogers and Lexington Steele Anal</title>
</head>
<body>
  <table>
    <tr>
      <td id="33802089" align="center" height="230" valign="top">
        <a name="33802089" href="https://www.imagefap.com/photo/33802089/?pgid=&amp;gid=13643086&amp;page=0" 
           original="https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
           data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="3840x2560" imageid="33802089" title="Jessie Rogers and Lexington Steele - 33802089.jpg">
          <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&amp;h=107&amp;fit=crop" 
               data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
               alt="Jessie Rogers and Lexington Steele - Photo 33802089" width="160" height="107">
        </a>
      </td>
      <td id="33802090" align="center" height="230" valign="top">
        <a name="33802090" href="https://www.imagefap.com/photo/33802090/?pgid=&amp;gid=13643086&amp;page=0" 
           original="https://cdnc.imagefap.com/images/full/118/338/33802090.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
           data-fallback-url="https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="3840x2560" imageid="33802090" title="Jessie Rogers and Lexington Steele - 33802090.jpg">
          <img src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=160&amp;h=107&amp;fit=crop" 
               data-fallback-url="https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
               alt="Jessie Rogers and Lexington Steele - Photo 33802090" width="160" height="107">
        </a>
      </td>
      <td id="33802091" align="center" height="230" valign="top">
        <a name="33802091" href="https://www.imagefap.com/photo/33802091/?pgid=&amp;gid=13643086&amp;page=0" 
           original="https://cdnc.imagefap.com/images/full/118/338/33802091.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
           data-fallback-url="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="4090x2727" imageid="33802091" title="Jessie Rogers and Lexington Steele - 33802091.jpg">
          <img src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=160&amp;h=107&amp;fit=crop" 
               data-fallback-url="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=4090&amp;auto=format&amp;fit=crop&amp;q=90"
               alt="Jessie Rogers and Lexington Steele - Photo 33802091" width="160" height="107">
        </a>
      </td>
      <td id="33802092" align="center" height="230" valign="top">
        <a name="33802092" href="https://www.imagefap.com/photo/33802092/?pgid=&amp;gid=13643086&amp;page=0" 
           original="https://cdnc.imagefap.com/images/full/118/338/33802092.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
           data-fallback-url="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="3840x2560" imageid="33802092" title="Jessie Rogers and Lexington Steele - 33802092.jpg">
          <img src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=160&amp;h=107&amp;fit=crop" 
               data-fallback-url="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
               alt="Jessie Rogers and Lexington Steele - Photo 33802092" width="160" height="107">
        </a>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
];
