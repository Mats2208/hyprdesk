fn main() {
    // Forzar a cargo a re-correr (y re-embeber el recurso de Windows) cuando cambian los iconos.
    // Sin esto, cambiar icon.ico no siempre re-embebe → el .exe queda con el icono viejo.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
