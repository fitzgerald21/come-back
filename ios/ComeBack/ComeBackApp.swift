import UIKit
import AVFoundation
import GoogleSignIn

// Plain UIKit rather than SwiftUI: importing SwiftUI and WebKit together pulls in an iOS 26-only overlay library,
// which would stop the app launching on earlier iOS versions.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Playback category: sound keeps going with the screen locked and ignores the silent switch.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        SitCoordinator.shared.start()

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.backgroundColor = UIColor(red: 0.051, green: 0.102, blue: 0.122, alpha: 1)
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }
}
