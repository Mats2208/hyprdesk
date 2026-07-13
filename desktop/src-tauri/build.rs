fn main() {
    // Forzar a cargo a re-correr (y re-embeber el recurso de Windows) cuando cambian los iconos.
    // Sin esto, cambiar icon.ico no siempre re-embebe → el .exe queda con el icono viejo.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons");

    // Lo mismo, y peor, con los recursos: los roles, las skills y el MCP bundleado.
    //
    // tauri_build copia `resources/` a `target/<profile>/resources/`, y en dev ESA es la copia que
    // la app lee (resource_dir() = el directorio del exe). Cargo no re-corre este build script si
    // no le declarás las entradas — así que editabas un rol, corrías la app, y seguía inyectando
    // la copia de hace dos días. En silencio, sin error, sin forma de notarlo.
    //
    // Es el mismo bug del icono, pero invisible: un .exe con el icono viejo se ve; un agente con
    // el rol viejo se comporta raro y no sabés por qué.
    println!("cargo:rerun-if-changed=resources");

    tauri_build::build()
}
