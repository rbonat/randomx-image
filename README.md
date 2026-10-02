# randomx-image

**English | [中文](README.zh-CN.md)**

[![Docker Hub](https://img.shields.io/docker/pulls/tuutoo/randomx-image.svg)](https://hub.docker.com/r/tuutoo/randomx-image)
[![Docker Image Size](https://img.shields.io/docker/image-size/tuutoo/randomx-image/latest)](https://hub.docker.com/r/tuutoo/randomx-image)
[![GitHub](https://img.shields.io/github/license/tuutoo/randomx-image)](https://github.com/tuutoo/randomx-image)

A lightweight random image API service built with Node.js, Sharp, and Docker.

## ✨ Features

- 🎲 Randomly serve images from a mounted directory
- � Upload and transform images on-the-fly
- 📐 Dynamic image resizing and cropping
- 🎨 Multiple output formats: `auto`, `jpg`, `png`, `webp`, `tiff`, `avif`
- ⚙️ Flexible parameters: `width`, `height`, `quality`, `withoutEnlargement`, `format`, `fit`, `background`
- 🚀 **Full Sharp API Access**: Complex image transformations via `transforms` parameter
- 🐳 Easy maintenance with Docker volume mounting
- ✅ Comprehensive test suite with 50+ test cases

## 📦 Quick Start

### Using Docker Hub (Recommended)

```bash
# Pull the latest image
docker pull tuutoo/randomx-image

# Run with local image directory
docker run -d -p 3000:3000 -v ./images:/app/images:ro tuutoo/randomx-image
```

Visit `http://localhost:3000/random-image` to get a random image.

### Using Docker Compose

1. **Prepare your images**
   Place images in the `./images` directory (subdirectories supported).

2. **Start the service**

   ```bash
   docker compose up -d --build
   ```

The service will be available at `http://localhost:3000`.

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## 📚 API Reference

### Health Check

```http
GET /health
```

Returns service status and image directory information.

### Random Image

```http
GET /random-image
```

**Query Parameters** (all optional):

| Parameter | Type | Description |
|-----------|------|-------------|
| `width` | integer | Target width in pixels |
| `height` | integer | Target height in pixels |
| `quality` | integer | Output quality (1-100) |
| `withoutEnlargement` | boolean | Prevent image upscaling (`true` or `1`) |
| `format` | string | Output format: `auto`, `jpg`, `png`, `webp`, `tiff`, `avif` |
| `fit` | string | Resize strategy: `cover`, `contain`, `inside`, `outside`, `smart` (default: `cover`) |
| `background` | string | Background mode for `fit=smart`: `blur` (optional) |
| `transforms` | JSON array | Advanced Sharp API transformations |

**Note**:
- Without parameters, returns the original image (preserves format and quality)
- When any transformation parameter is provided, Sharp processes the image

### Image Cropping and Scaling

When both `width` and `height` are specified, the image processing behavior is controlled by the `fit` parameter:

- **`cover` (default)**: Image is scaled and cropped to fill the specified dimensions
  - Resizes to cover the entire target area
  - Excess parts are cropped from the center
  - Ideal for fixed-size thumbnails

- **`contain`**: Image is scaled to fit entirely within specified dimensions
  - Maintains aspect ratio
  - No cropping
  - May have whitespace on edges

- **`inside`**: Similar to `contain`, but only shrinks if necessary
  - Preserves original size if smaller than target

- **`outside`**: Ensures image meets minimum dimensions
  - Maintains aspect ratio
  - May exceed specified dimensions
    
- **`smart`**: Automatically chooses the best layout based on the image and target aspect ratios
  - Landscape images use `contain` to preserve the complete image
  - Portrait images use `contain` to preserve the complete image
  - With `background=blur`, portrait images are displayed over a blurred version of the same image
  - Requires both `width` and `height`
  - Useful for displays with a fixed aspect ratio, such as wall panels and photo frames

**Examples**:
```http
# Crop to 800x600 with cover mode (default)
GET /random-image?width=800&height=600

# Fit completely without cropping
GET /random-image?width=800&height=600&fit=contain
```

### Transform Image

```http
POST /transform-image
```

Upload and transform an image with the same parameters as `/random-image`.

**Request Format**: `multipart/form-data`

**Form Field**: `image` (required) - The image file to upload

**Query Parameters**: Same as `/random-image` endpoint (all optional)

**Supported Image Formats**:
- Input: `.jpg`, `.jpeg`, `.png`, `.webp`, `.tif`, `.tiff`, `.avif`, `.gif`, `.heic`, `.heif`
- Output: `jpg`, `png`, `webp`, `tiff`, `avif` (controlled by `format` parameter)

**File Size Limit**: 50MB

**Examples**:

```bash
# Upload and return original image
curl -X POST -F "image=@photo.jpg" http://localhost:3000/transform-image

# Resize uploaded image
curl -X POST -F "image=@photo.jpg" "http://localhost:3000/transform-image?width=800&height=600"

# Convert format and apply quality
curl -X POST -F "image=@photo.png" "http://localhost:3000/transform-image?format=webp&quality=85"

# Apply transforms: grayscale and blur
curl -X POST -F "image=@photo.jpg" "http://localhost:3000/transform-image?transforms=[[\"grayscale\"],[\"blur\",5]]"

# Combine all parameters
curl -X POST -F "image=@photo.jpg" \
  "http://localhost:3000/transform-image?width=500&format=jpg&quality=90&transforms=[[\"sharpen\"]]"
```

**Response**:
- Success: Returns the processed image with appropriate `Content-Type` header
- Error: Returns JSON with error message (HTTP 400)

## 🎨 Sharp API Transforms

The `transforms` parameter provides full access to Sharp's powerful API for complex image transformations.
Format: JSON array where each element is `[methodName, ...args]`.

**Sharp API Mapping Examples**:

| Sharp API Code | Equivalent `transforms` Parameter |
|---------------|----------------------------------|
| `.rotate(90)` | `[["rotate", 90]]` |
| `.rotate(90).blur(10).tint(255, 0, 255)` | `[["rotate", 90], ["blur", 10], ["tint", 255, 0, 255]]` |
| `.negate({alpha: false})` | `[["negate", {"alpha": false}]]` |
| `.grayscale().sharpen()` | `[["grayscale"], ["sharpen"]]` |

**URL Examples**:

```http
# Rotate 90 degrees
GET /random-image?transforms=[["rotate",90]]

# Rotate, blur, and tint
GET /random-image?transforms=[["rotate",90],["blur",10],["tint",255,0,255]]

# Grayscale and sharpen
GET /random-image?transforms=[["grayscale"],["sharpen"]]

# Negative effect
GET /random-image?transforms=[["negate",{"alpha":false}]]

# Combine with basic parameters
GET /random-image?width=800&height=600&transforms=[["rotate",45],["blur",5]]&format=webp
```

For more Sharp API methods, see [Sharp Documentation](https://sharp.pixelplumbing.com/api-operation).

## 🧪 Testing

The project includes a comprehensive test suite covering all API parameters and functionality.

```bash
# Run all tests
npm test

# Watch mode (for development)
npm run test:watch

# Generate coverage report
npm run test:coverage
```

For detailed testing information, see [TESTING.md](TESTING.md).

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `IMAGE_DIR` | `./images` | Image directory path |

### Docker Volume Mounting

Mount your local image directory to `/app/images` in the container:

```bash
docker run -d -p 3000:3000 -v /path/to/your/images:/app/images:ro tuutoo/randomx-image
```

## 📁 Project Structure

```
randomx-image/
├── src/
│   ├── server.js         # Main API service
│   └── server.test.js    # Test suite
├── images/               # Local image directory (mount to container)
├── Dockerfile            # Docker image configuration
├── docker-compose.yml    # Docker Compose configuration
├── package.json
├── TESTING.md           # Detailed testing guide
└── README.md
```

## 🛠️ Technology Stack

- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **Sharp** - High-performance image processing
- **Docker** - Containerization
- **Vitest** - Testing framework
- **Supertest** - API testing

## 📝 License

MIT

## 🔗 Links

- [GitHub Repository](https://github.com/tuutoo/randomx-image)
- [Docker Hub](https://hub.docker.com/r/tuutoo/randomx-image)
- [Sharp Documentation](https://sharp.pixelplumbing.com)
