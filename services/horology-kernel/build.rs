fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")?;
    let proto_dir = std::path::Path::new(&manifest_dir)
        .join("../../proto")
        .canonicalize()?;
    let proto_file = proto_dir.join("timer.proto");

    let proto_str = proto_file
        .to_str()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "invalid proto path"))?;
    let include_str = proto_dir
        .to_str()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "invalid include path"))?;

    tonic_build::configure()
        .build_server(true)
        .compile_well_known_types(true)
        .extern_path(".google.protobuf.Timestamp", "::prost_types::Timestamp")
        .extern_path(".google.protobuf.Struct", "::prost_types::Struct")
        .compile(&[proto_str], &[include_str])?;

    println!("cargo:rerun-if-changed={proto_str}");
    println!("cargo:rerun-if-changed={include_str}");
    Ok(())
}
