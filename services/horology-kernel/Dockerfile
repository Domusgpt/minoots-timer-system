# syntax=docker/dockerfile:1

FROM rust:1.75-bullseye AS builder
WORKDIR /app

COPY services/horology-kernel/Cargo.toml services/horology-kernel/Cargo.lock services/horology-kernel/build.rs ./services/horology-kernel/
COPY proto ./proto
RUN mkdir -p services/horology-kernel/src
RUN echo "fn main() {}" > services/horology-kernel/src/main.rs
RUN cd services/horology-kernel && cargo build --release --bin kernel || true

COPY services/horology-kernel/src ./services/horology-kernel/src
RUN cd services/horology-kernel && cargo build --release --bin kernel

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=builder /app/services/horology-kernel/target/release/kernel /usr/local/bin/kernel
EXPOSE 50051
ENV KERNEL_GRPC_ADDR=0.0.0.0:50051
CMD ["/usr/local/bin/kernel"]
