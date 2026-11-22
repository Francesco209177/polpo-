import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// La versione è quella del firmware e di Polpo Studio (polpo/scripts/version.py): una sola per tutto il progetto.
val versione: String = Regex("VERSION = \"([0-9]+\\.[0-9]+\\.[0-9]+)\"")
    .find(rootProject.file("../polpo/scripts/version.py").readText())?.groupValues?.get(1)
    ?: error("versione non trovata in polpo/scripts/version.py")
val (maggiore, minore, correzione) = versione.split(".").map { it.toInt() }

// Il sito costruito per l'app (python site/build.py --app ...): vedi android/LEGGIMI.md.
val sito = layout.buildDirectory.dir("sito")

// Firma delle versioni pubblicate: la chiave arriva dai segreti di GitHub, mai dal repository.
val fileChiave: String? = System.getenv("POLPO_FIRMA_FILE")
val passwordChiave: String? = System.getenv("POLPO_FIRMA_PASSWORD")

android {
    namespace = "io.github.francesco209177.polpo"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.francesco209177.polpo"
        minSdk = 26
        targetSdk = 36
        versionCode = maggiore * 10000 + minore * 100 + correzione
        versionName = versione
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (fileChiave != null && passwordChiave != null) {
            create("polpo") {
                storeFile = file(fileChiave)
                storePassword = passwordChiave
                keyAlias = "polpo"
                keyPassword = passwordChiave
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("polpo")
        }
    }

    // solo italiano, anche per i testi delle librerie AndroidX
    androidResources {
        localeFilters += listOf("it")
    }

    sourceSets {
        getByName("main").assets.srcDir(sito)
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // nessun accesso a Internet: niente avvisi sulle librerie da aggiornare via rete
        checkDependencies = false
        disable += listOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
    }
}

kotlin {
    // qualsiasi JDK dal 17 in su compila; il codice prodotto è per Java 17
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

// Senza il sito l'app sarebbe vuota: meglio un errore chiaro.
tasks.named("preBuild") {
    doFirst {
        if (!sito.get().file("index.html").asFile.isFile) {
            throw GradleException("manca il sito per l'app: esegui prima android/prepara_sito.sh (vedi android/LEGGIMI.md)")
        }
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.core:core-ktx:1.17.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core-ktx:1.7.0")
}
