import SwiftUI

enum Appearance: String, CaseIterable {
    case system, light, dark
    var label: String { switch self { case .system: "System"; case .light: "Hell"; case .dark: "Dunkel" } }
    var scheme: ColorScheme? { switch self { case .system: nil; case .light: .light; case .dark: .dark } }
}

/// Einstellungen (src/pages/einstellungen.astro): appearance, the Kickbase and the LigaInsider login.
struct SettingsView: View {
    @Environment(Account.self) private var account
    @AppStorage("appearance") private var appearance: Appearance = .system
    @State private var logoutProblem: String?

    var body: some View {
        Form {
            Section("Darstellung") {
                Picker("Darstellung", selection: $appearance) {
                    ForEach(Appearance.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                if account.kickbase {
                    signedIn(name: account.kickbaseName) { logoutProblem = await account.logOutKickbase() }
                } else {
                    LoginForm(intro: "Für dein Team, die Aufstellungen und die passenden News.",
                              userPrompt: "Kickbase E-Mail", userType: .emailAddress) { user, password in
                        await account.logInKickbase(email: user, password: password)
                    }
                }
            } header: { Text("Kickbase") }
            Section {
                if account.ligaInsider {
                    signedIn(name: account.ligaInsiderName) { logoutProblem = await account.logOutLigaInsider() }
                } else {
                    LoginForm(intro: "Zum Kommentieren, Antworten, Hochvoten und für Umfragen.",
                              userPrompt: "Benutzername oder E-Mail", userType: .username) { user, password in
                        await account.logInLigaInsider(username: user, password: password)
                    }
                }
            } header: { Text("LigaInsider") }
        }
        .scrollContentBackground(.hidden)
        .background(Color.tiBackground)
        .navigationTitle("Einstellungen")
        .alert(logoutProblem ?? "", isPresented: Binding(get: { logoutProblem != nil }, set: { if !$0 { logoutProblem = nil } })) {}
    }

    private func signedIn(name: String?, logOut: @escaping () async -> Void) -> some View {
        Group {
            if let name { Text("Angemeldet als **\(name)**.") } else { Text("Angemeldet.") }
            Button("Abmelden", role: .destructive) { Task { await logOut() } }
        }
    }
}

private struct LoginForm: View {
    let intro: String
    let userPrompt: String
    let userType: UITextContentType
    let submit: (String, String) async -> String?

    @State private var user = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Text(intro).foregroundStyle(Color.tiMuted)
        TextField(userPrompt, text: $user)
            .textContentType(userType)
            .keyboardType(userType == .emailAddress ? .emailAddress : .default)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        SecureField("Passwort", text: $password).textContentType(.password)
        if let error { Text(error).foregroundStyle(Color.tiRed) }
        Button {
            busy = true
            Task {
                error = await submit(user.trimmingCharacters(in: .whitespaces), password)
                if error == nil { password = "" }
                busy = false
            }
        } label: {
            HStack {
                Text("Anmelden").fontWeight(.semibold)
                if busy { Spacer(); ProgressView() }
            }
        }
        .disabled(busy || user.isEmpty || password.isEmpty)
    }
}
