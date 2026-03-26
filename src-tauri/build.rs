fn main() {
  copy_gnullvm_runtime();
  tauri_build::build();
}

fn copy_gnullvm_runtime() {
  use std::env;
  use std::fs;
  use std::path::{Path, PathBuf};

  let target = env::var("TARGET").unwrap_or_default();
  if !target.contains("gnullvm") {
    return;
  }

  let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR must be set"));
  let profile = env::var("PROFILE").expect("PROFILE must be set");
  let release_dir = out_dir
    .ancestors()
    .find(|ancestor| ancestor.file_name().is_some_and(|value| value == std::ffi::OsStr::new(&profile)))
    .expect("release directory should exist");

  let runtime_source = Path::new("runtime").join("libunwind.dll");
  let runtime_target = release_dir.join("libunwind.dll");

  println!("cargo:rerun-if-changed={}", runtime_source.display());
  fs::copy(&runtime_source, &runtime_target).expect("failed to copy gnullvm runtime DLL");
}
