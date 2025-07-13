# Multi-stage Dockerfile for Memos
# Stage 1: Build the frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app/web

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY web/package*.json web/pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy frontend source
COPY web/ .

# Build the frontend
RUN pnpm build

# Stage 2: Build the backend
FROM golang:1.24-alpine AS backend-builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Copy built frontend from previous stage to the correct embedded location
COPY --from=frontend-builder /app/web/dist ./server/router/frontend/dist

# Build the application (frontend files are now embedded)
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o memos ./bin/memos/main.go

# Stage 3: Final runtime image
FROM alpine:latest

# Install runtime dependencies
RUN apk --no-cache add ca-certificates tzdata wget

# Create non-root user
RUN addgroup -g 1000 memos && \
    adduser -D -s /bin/sh -u 1000 -G memos memos

# Set working directory
WORKDIR /usr/local/memos

# Copy binary from builder
COPY --from=backend-builder /app/memos .

# Create data directory
RUN mkdir -p /var/opt/memos && \
    chown -R memos:memos /var/opt/memos /usr/local/memos

# Switch to non-root user
USER memos

# Expose port (default port from main.go)
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8081/api/ping || exit 1

# Set environment variables
ENV MEMOS_MODE=prod
ENV MEMOS_PORT=8081
ENV MEMOS_DATA=/var/opt/memos

# Run the application
CMD ["./memos"]