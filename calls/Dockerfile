FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY internal/ ./internal/
RUN CGO_ENABLED=0 go build -trimpath -o /out/spark-calls .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
COPY --from=build /out/spark-calls /usr/local/bin/spark-calls
USER 65532:65532
EXPOSE 8002
ENTRYPOINT ["/usr/local/bin/spark-calls"]
