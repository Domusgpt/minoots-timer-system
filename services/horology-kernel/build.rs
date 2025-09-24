fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_root = std::path::PathBuf::from("../../proto");
    let proto_file = proto_root.join("timer.proto");

    tonic_build::configure()
        .build_server(true)
        .compile_well_known_types(true)
        .extern_path(".google.protobuf", "::prost_types")
        .compile(&[proto_file.clone()], &[proto_root.clone()])?;

    println!("cargo:rerun-if-changed={}", proto_file.display());
    println!("cargo:rerun-if-changed={}", proto_root.display());
    Ok(())
}
