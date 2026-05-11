//
//  MitallerApp.swift
//  Mitaller
//
//  Created by Angel Velasco on 5/5/26.
//

import SwiftUI
import UIKit

@main
struct MitallerApp: App {
    init() {
        configureAppearance()
        configureCaches()
    }

    private func configureCaches() {
        URLCache.shared = URLCache(memoryCapacity: 64 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024, diskPath: "mitaller-shared-cache")
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                AppTheme.canvasTop.ignoresSafeArea()
                ContentView()
            }
            .preferredColorScheme(.dark)
            .tint(AppTheme.blue)
        }
    }

    private func configureAppearance() {
        let canvas = UIColor(AppTheme.canvasTop)
        let surface = UIColor(AppTheme.surface)
        let ink = UIColor(AppTheme.ink)
        let muted = UIColor(AppTheme.muted)

        // Navigation bars
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = canvas
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: ink]
        nav.largeTitleTextAttributes = [.foregroundColor: ink]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = UIColor(AppTheme.blue)

        // Tab bar
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = surface
        tab.shadowColor = UIColor(AppTheme.line)
        let item = UITabBarItemAppearance()
        item.normal.iconColor = muted
        item.normal.titleTextAttributes = [.foregroundColor: muted]
        item.selected.iconColor = UIColor(AppTheme.blue)
        item.selected.titleTextAttributes = [.foregroundColor: UIColor(AppTheme.blue)]
        tab.stackedLayoutAppearance = item
        tab.inlineLayoutAppearance = item
        tab.compactInlineLayoutAppearance = item
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        // Tables / lists
        UITableView.appearance().backgroundColor = .clear
        UICollectionView.appearance().backgroundColor = .clear
        UIScrollView.appearance().backgroundColor = .clear
        UITextField.appearance().keyboardAppearance = .dark
    }
}
