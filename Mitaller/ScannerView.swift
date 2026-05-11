//
//  ScannerView.swift
//  Mitaller
//

import AVFoundation
import SwiftUI
import UIKit

struct BarcodeScannerView: UIViewControllerRepresentable {
    var capturesPhoto: Bool = false
    var continuous: Bool = false
    var onCode: (String, Data?) -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.capturesPhoto = capturesPhoto
        controller.continuous = continuous
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate, AVCapturePhotoCaptureDelegate {
    var capturesPhoto: Bool = false
    var continuous: Bool = false
    var onCode: ((String, Data?) -> Void)?
    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let photoOutput = AVCapturePhotoOutput()
    private var pendingCode: String?
    private var lastEmittedAt: Date = .distantPast
    private var lastEmittedCode: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning {
            session.stopRunning()
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            showUnavailableLabel()
            return
        }

        session.beginConfiguration()
        session.sessionPreset = capturesPhoto ? .photo : .high
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            showUnavailableLabel()
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.ean8, .ean13, .code128, .qr, .code39, .dataMatrix]

        if capturesPhoto, session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
        }

        session.commitConfiguration()

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        previewLayer = layer

        let guide = UIView()
        guide.translatesAutoresizingMaskIntoConstraints = false
        guide.layer.borderWidth = 3
        guide.layer.borderColor = UIColor.systemTeal.cgColor
        guide.layer.cornerRadius = 12
        view.addSubview(guide)
        NSLayoutConstraint.activate([
            guide.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            guide.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            guide.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.72),
            guide.heightAnchor.constraint(equalToConstant: 180)
        ])
    }

    private func showUnavailableLabel() {
        let label = UILabel()
        label.text = "Camara no disponible"
        label.textColor = .white
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue else { return }

        if continuous {
            let now = Date()
            if value == lastEmittedCode && now.timeIntervalSince(lastEmittedAt) < 1.2 {
                return
            }
            lastEmittedCode = value
            lastEmittedAt = now
            onCode?(value, nil)
            return
        }

        guard pendingCode == nil else { return }
        pendingCode = value

        if capturesPhoto {
            let settings = AVCapturePhotoSettings()
            settings.flashMode = .off
            photoOutput.capturePhoto(with: settings, delegate: self)
        } else {
            session.stopRunning()
            onCode?(value, nil)
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let data = photo.fileDataRepresentation()
        let compressed = Self.compressedJPEG(from: data)
        session.stopRunning()
        if let code = pendingCode {
            onCode?(code, compressed)
        }
    }

    private static func compressedJPEG(from data: Data?) -> Data? {
        guard let data, let image = UIImage(data: data) else { return data }
        let maxDimension: CGFloat = 1280
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        UIGraphicsBeginImageContextWithOptions(newSize, true, 1)
        image.draw(in: CGRect(origin: .zero, size: newSize))
        let resized = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return (resized ?? image).jpegData(compressionQuality: 0.6)
    }
}
