fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_path = std::path::PathBuf::from("../../proto/timer.proto");
    println!("cargo:rerun-if-changed={}", proto_path.display());
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(&[proto_path.clone()], &[proto_path.parent().unwrap()])?;
    Ok(())
}
