import * as vscode from "vscode";
import * as path from "path";
import {
  LanguageClient,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

// Define diagnostic collection to report problems
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext) {
  // Create diagnostic collection for accessibility issues
  diagnosticCollection = vscode.languages.createDiagnosticCollection('flutter-a11y');
  ctx.subscriptions.push(diagnosticCollection);

  // Start Dart Analysis Server
  const serverOptions: ServerOptions = {
    command: "dart",
    args: ["language-server"],
    transport: TransportKind.stdio,
  };
  
  const client = new LanguageClient(
    "dartAnalysis",
    "Dart Analysis Server",
    serverOptions,
    { documentSelector: [{ scheme: "file", language: "dart" }] }
  );
  
  // Start client and register for disposal
  client.start();
  ctx.subscriptions.push(client);
  
  // Register the accessibility code action provider
  const providerDisposable = vscode.languages.registerCodeActionsProvider(
    { language: "dart", scheme: "file" },
    new A11yCodeActionProvider(),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
  ctx.subscriptions.push(providerDisposable);
  
  // Register scan workspace command - explicitly expose in command palette
  const scanWorkspaceDisposable = vscode.commands.registerCommand(
    "flutter-a11y.scanWorkspace",
    scanWorkspaceForA11yIssues
  );
  ctx.subscriptions.push(scanWorkspaceDisposable);
  
  // Register the accessibility diagnostic provider for opened files
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.languageId === 'dart') {
        analyzeDartFile(event.document);
      }
    })
  );
  
  // Register for all currently opened files
  if (vscode.window.activeTextEditor) {
    analyzeDartFile(vscode.window.activeTextEditor.document);
  }
  
  // Run when files are opened
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'dart') {
        analyzeDartFile(editor.document);
      }
    })
  );
  
  // Register checklist command
  const checklistDisposable = vscode.commands.registerCommand(
    "flutter-a11y.showChecklist",
    () => {
      vscode.window.showInformationMessage(
        "Flutter Accessibility Checklist:\n" +
        "- Use semanticLabel on Images\n" +
        "- Wrap interactive elements in Semantics\n" +
        "- Test color contrast with accessibility tools\n" +
        "- Use ExcludeSemantics with decorative elements\n" +
        "- Check readability with TalkBack/VoiceOver"
      );
    }
  );
  ctx.subscriptions.push(checklistDisposable);
  
  // Show a welcome message with instructions
  showWelcomeMessage();
}

function showWelcomeMessage() {
  vscode.window.showInformationMessage(
    "Flutter Accessibility Extension activated! Use 'Scan Workspace for A11y Issues' from the command palette.",
    "Scan Now"
  ).then(selection => {
    if (selection === "Scan Now") {
      vscode.commands.executeCommand("flutter-a11y.scanWorkspace");
    }
  });
}

// Code action provider for accessibility fixes
class A11yCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    
    // Only provide actions when we have diagnostics
    if (context.diagnostics.length === 0) {
      return actions;
    }
    
    // Find our accessibility diagnostics
    const a11yDiagnostics = context.diagnostics.filter(
      d => d.source === 'flutter-a11y'
    );
    
    for (const diagnostic of a11yDiagnostics) {
      const widget = this.getWidgetFromDiagnostic(doc, diagnostic.range);
      
      if (widget) {
        // Add action to wrap in Semantics
        const wrapAction = new vscode.CodeAction(
          "Wrap in Semantics",
          vscode.CodeActionKind.QuickFix
        );
        wrapAction.diagnostics = [diagnostic];
        
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          doc.uri,
          diagnostic.range,
          `Semantics(
  label: 'TODO: Add descriptive label',
  child: ${widget}
)`
        );
        wrapAction.edit = edit;
        actions.push(wrapAction);
        
        // Add semanticLabel action for Image widgets
        if (widget.startsWith('Image')) {
          const labelAction = new vscode.CodeAction(
            "Add semanticLabel to Image",
            vscode.CodeActionKind.QuickFix
          );
          labelAction.diagnostics = [diagnostic];
          
          // Handle the insertion of semanticLabel parameter
          const imageEdit = new vscode.WorkspaceEdit();
          // Find the closing parenthesis
          const closingParenIndex = widget.lastIndexOf(')');
          if (closingParenIndex > 0) {
            // Insert before the closing parenthesis
            const insertPosition = doc.positionAt(
              doc.offsetAt(diagnostic.range.start) + closingParenIndex
            );
            imageEdit.insert(
              doc.uri,
              insertPosition,
              ", semanticLabel: 'TODO: Add descriptive label'"
            );
            labelAction.edit = imageEdit;
            actions.push(labelAction);
          }
        }
      }
    }
    
    return actions;
  }
  
  private getWidgetFromDiagnostic(doc: vscode.TextDocument, range: vscode.Range): string {
    return doc.getText(range);
  }
}

// Function to analyze a Dart file for accessibility issues
function analyzeDartFile(document: vscode.TextDocument) {
  if (document.languageId !== 'dart') {
    return;
  }
  
  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];
  
  // Pattern for widgets that likely need semantics
  const interactiveWidgets = [
    'GestureDetector', 'InkWell', 'TextButton', 'ElevatedButton', 
    'IconButton', 'FloatingActionButton', 'Image', 'TextField',
    'Switch', 'Checkbox', 'Radio', 'Slider', 'ListTile'
  ];
  
  // Check for interactive widgets without Semantics
  for (const widget of interactiveWidgets) {
    const widgetRegex = new RegExp(`${widget}\\s*\\((?![\\s\\S]*Semantics)[\\s\\S]*?\\)`, 'g');
    let match;
    
    while ((match = widgetRegex.exec(text)) !== null) {
      // Check if this widget is already wrapped in Semantics
      const startPos = match.index;
      const endPos = match.index + match[0].length;
      const lineStart = document.positionAt(startPos);
      const lineEnd = document.positionAt(endPos);
      
      // Create diagnostic for the widget
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(lineStart, lineEnd),
        `${widget} should be wrapped in Semantics for accessibility`,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = 'flutter-a11y';
      diagnostic.code = 'missing-semantics';
      diagnostics.push(diagnostic);
    }
  }
  
  // Check for Images without semanticLabel
  const imageWithoutLabelRegex = /Image\.[a-zA-Z]*\((?![\s\S]*semanticLabel)[\s\S]*?\)/g;
  let imageMatch;
  
  while ((imageMatch = imageWithoutLabelRegex.exec(text)) !== null) {
    const startPos = imageMatch.index;
    const endPos = imageMatch.index + imageMatch[0].length;
    const lineStart = document.positionAt(startPos);
    const lineEnd = document.positionAt(endPos);
    
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineStart, lineEnd),
      `Image should have a semanticLabel for screen readers`,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'flutter-a11y';
    diagnostic.code = 'missing-semantic-label';
    diagnostics.push(diagnostic);
  }
  
  // Check for buttons without onPress callbacks that have semantics
  const buttonRegex = /(TextButton|ElevatedButton|OutlinedButton|IconButton)\(\s*(?![\s\S]*onPressed)[\s\S]*?\)/g;
  let buttonMatch;
  
  while ((buttonMatch = buttonRegex.exec(text)) !== null) {
    const startPos = buttonMatch.index;
    const endPos = buttonMatch.index + buttonMatch[0].length;
    const lineStart = document.positionAt(startPos);
    const lineEnd = document.positionAt(endPos);
    
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineStart, lineEnd),
      `Button missing onPressed callback - inaccessible to screen readers`,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = 'flutter-a11y';
    diagnostic.code = 'missing-onpressed';
    diagnostics.push(diagnostic);
  }
  
  // Update diagnostics collection
  diagnosticCollection.set(document.uri, diagnostics);
}

// Scan the entire workspace for accessibility issues
async function scanWorkspaceForA11yIssues() {
  // Clear existing diagnostics before starting a new scan
  diagnosticCollection.clear();
  
  // Show progress indicator
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Scanning Flutter files for accessibility issues...",
    cancellable: true
  }, async (progress, token) => {
    try {
      // Find all Dart files in the workspace
      const dartFiles = await vscode.workspace.findFiles(
        '**/*.dart', 
        '**/build/**', // Exclude build directory
        1000 // Limit to 1000 files for performance
      );
      
      const total = dartFiles.length;
      console.log(`Found ${total} Dart files to scan`);
      
      if (total === 0) {
        vscode.window.showInformationMessage(`No Dart files found in workspace to scan.`);
        return;
      }
      
      let processed = 0;
      let issueCount = 0;
      const filesWithIssues: string[] = [];
      
      // Process each file
      for (const fileUri of dartFiles) {
        if (token.isCancellationRequested) {
          vscode.window.showInformationMessage(`Scan cancelled after ${processed} files.`);
          return;
        }
        
        try {
          // Open the document
          const document = await vscode.workspace.openTextDocument(fileUri);
          
          // Analyze file
          analyzeDartFile(document);
          
          // Check if we found issues
          const diagnostics = diagnosticCollection.get(fileUri) || [];
          if (diagnostics.length > 0) {
            filesWithIssues.push(path.basename(fileUri.fsPath));
            issueCount += diagnostics.length;
          }
          
          // Update progress
          processed++;
          progress.report({ 
            increment: (1 / total) * 100,
            message: `Scanned: ${processed}/${total} (${path.basename(fileUri.fsPath)})`
          });
        } catch (err) {
          console.error(`Error processing ${fileUri.fsPath}:`, err);
        }
      }
      
      // Show summary notification with results
      const message = `Accessibility scan completed: Found ${issueCount} potential issues in ${filesWithIssues.length} files.`;
      
      if (issueCount > 0) {
        vscode.window.showWarningMessage(message, "Show Problems").then(selection => {
          if (selection === "Show Problems") {
            vscode.commands.executeCommand("workbench.action.problems.focus");
          }
        });
        
        // Log files with issues to output channel for reference
        const outputChannel = vscode.window.createOutputChannel("Flutter A11y Scanner");
        outputChannel.appendLine(`Flutter Accessibility Scan Results: ${new Date().toLocaleString()}`);
        outputChannel.appendLine(`Found ${issueCount} accessibility issues in ${filesWithIssues.length} files:`);
        filesWithIssues.forEach((file, index) => {
          outputChannel.appendLine(`${index + 1}. ${file}`);
        });
        outputChannel.show();
      } else {
        vscode.window.showInformationMessage(`No accessibility issues found in ${total} dart files.`);
      }
    } catch (err) {
      console.error("Error during workspace scan:", err);
      vscode.window.showErrorMessage(`Error scanning workspace: ${err}`);
    }
  });
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }
}