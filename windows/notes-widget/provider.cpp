#include <filesystem>
#include <string>
#include <vector>
#include <windows.h>
#include <winrt/Microsoft.Windows.Widgets.Providers.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Foundation.h>

using namespace winrt;
using namespace Microsoft::Windows::Widgets::Providers;
using namespace Windows::Data::Json;

namespace
{
constexpr GUID provider_id{0x7f455b49, 0x267d, 0x445f, {0x82, 0xb4, 0x11, 0xb1, 0x44, 0x69, 0xcd, 0xa1}};
HANDLE idle_event{};
bool chinese()
{
    return PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_CHINESE;
}

std::filesystem::path installed_studio()
{
    constexpr auto key = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ZiCode Studio Desktop";
    for (auto hive : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE})
    {
        for (auto view : {RRF_SUBKEY_WOW6464KEY, RRF_SUBKEY_WOW6432KEY})
        {
            wchar_t version[64]{};
            DWORD version_size = sizeof(version);
            if (RegGetValueW(hive, key, L"DisplayVersion", RRF_RT_REG_SZ | view, nullptr, version, &version_size) !=
                ERROR_SUCCESS)
                continue;
            unsigned major = 0, minor = 0, patch = 0;
            if (swscanf_s(version, L"%u.%u.%u", &major, &minor, &patch) != 3 ||
                (major == 0 && (minor < 6 || (minor == 6 && patch < 9))))
                continue;
            wchar_t dir[32768]{};
            DWORD size = sizeof(dir);
            if (RegGetValueW(hive, key, L"InstallLocation", RRF_RT_REG_SZ | view, nullptr, dir, &size) != ERROR_SUCCESS)
                continue;
            std::wstring path(dir);
            if (path.size() > 1 && path.front() == L'"' && path.back() == L'"')
                path = path.substr(1, path.size() - 2);
            auto exe = std::filesystem::path(path) / L"zicode-studio-desktop.exe";
            if (exe.is_absolute() && std::filesystem::is_regular_file(exe))
                return exe;
        }
    }
    throw hresult_error(HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND));
}

void launch(std::wstring const &action)
{
    // Only the three actions declared by the card can reach process creation.
    if (action != L"new" && action != L"recent" && action != L"pinned")
        throw hresult_invalid_argument();
    const auto exe = installed_studio();
    auto command = L"\"" + exe.wstring() + L"\" --notes-widget " + action;
    STARTUPINFOW startup{sizeof(startup)};
    PROCESS_INFORMATION process{};
    check_bool(CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr,
                              exe.parent_path().c_str(), &startup, &process));
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
}

hstring card(bool unavailable)
{
    bool zh = chinese();
    JsonObject result;
    result.SetNamedValue(L"type", JsonValue::CreateStringValue(L"AdaptiveCard"));
    result.SetNamedValue(L"version", JsonValue::CreateStringValue(L"1.5"));
    JsonArray actions;
    for (auto [verb, title] : std::initializer_list<std::pair<const wchar_t *, const wchar_t *>>{
             {L"new", zh ? L"新建笔记" : L"New note"},
             {L"recent", zh ? L"打开最近笔记" : L"Open recent note"},
             {L"pinned", zh ? L"打开置顶笔记" : L"Open pinned note"}})
    {
        JsonObject button;
        button.SetNamedValue(L"type", JsonValue::CreateStringValue(L"Action.Execute"));
        button.SetNamedValue(L"title", JsonValue::CreateStringValue(title));
        button.SetNamedValue(L"verb", JsonValue::CreateStringValue(verb));
        actions.Append(button);
    }
    JsonArray body;
    if (unavailable)
    {
        JsonObject status;
        status.SetNamedValue(L"type", JsonValue::CreateStringValue(L"TextBlock"));
        status.SetNamedValue(L"wrap", JsonValue::CreateBooleanValue(true));
        status.SetNamedValue(
            L"text", JsonValue::CreateStringValue(zh ? L"请先安装支持速记小组件的 Studio。"
                                                     : L"Install a version of Studio that supports Quick Notes."));
        body.Append(status);
    }
    for (auto const &action : actions)
    {
        JsonObject row;
        JsonArray one;
        one.Append(action);
        row.SetNamedValue(L"type", JsonValue::CreateStringValue(L"ActionSet"));
        row.SetNamedValue(L"actions", one);
        body.Append(row);
    }
    result.SetNamedValue(L"body", body);
    return result.Stringify();
}

void update(WidgetContext const &context, bool unavailable = false)
{
    WidgetUpdateRequestOptions update(context.Id());
    update.Template(card(unavailable));
    WidgetManager::GetDefault().UpdateWidget(update);
}

struct Provider : implements<Provider, IWidgetProvider>
{
    Provider()
    {
        CoAddRefServerProcess();
    }
    ~Provider()
    {
        if (CoReleaseServerProcess() == 0)
            SetEvent(idle_event);
    }
    void CreateWidget(WidgetContext const &context)
    {
        update(context);
    }
    void DeleteWidget(hstring const &, hstring const &)
    {
    }
    void Activate(WidgetContext const &context)
    {
        update(context);
    }
    void Deactivate(hstring const &)
    {
    }
    void OnWidgetContextChanged(WidgetContextChangedArgs const &args)
    {
        update(args.WidgetContext());
    }
    void OnActionInvoked(WidgetActionInvokedArgs const &args)
    {
        try
        {
            launch(std::wstring(args.Verb()));
        }
        catch (...)
        {
            update(args.WidgetContext(), true);
        }
    }
};

struct Factory : implements<Factory, IClassFactory>
{
    HRESULT __stdcall CreateInstance(IUnknown *outer, REFIID iid, void **result) noexcept override
    {
        if (!result)
            return E_POINTER;
        *result = nullptr;
        if (outer)
            return CLASS_E_NOAGGREGATION;
        try
        {
            return make<Provider>().as(iid, result);
        }
        catch (...)
        {
            return to_hresult();
        }
    }
    HRESULT __stdcall LockServer(BOOL lock) noexcept override
    {
        if (lock)
            CoAddRefServerProcess();
        else if (CoReleaseServerProcess() == 0)
            SetEvent(idle_event);
        return S_OK;
    }
};
} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR command, int)
{
    if (std::wstring(command) != L"-ActivateNotesWidget")
        return 0;
    try
    {
        init_apartment(apartment_type::multi_threaded);
        handle idle(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        idle_event = idle.get();
        if (!idle_event)
            return 1;
        auto factory = make<Factory>();
        DWORD cookie{};
        check_hresult(
            CoRegisterClassObject(provider_id, factory.get(), CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE, &cookie));
        WaitForSingleObject(idle_event, INFINITE);
        CoRevokeClassObject(cookie);
        return 0;
    }
    catch (...)
    {
        return 1;
    }
}

#ifdef STUDIO_TEST_NOTES_WIDGET
// Creates the COM provider in-process and reads its actual card. This test
// installs nothing, starts no Studio and does not require a registered board.
int wmain()
{
    init_apartment(apartment_type::multi_threaded);
    handle idle(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    idle_event = idle.get();
    auto factory = make<Factory>();
    winrt::com_ptr<::IUnknown> provider;
    check_hresult(factory->CreateInstance(nullptr, guid_of<IWidgetProvider>(), provider.put_void()));
    const std::vector<hstring> verbs{L"new", L"recent", L"pinned"};
    auto body = JsonObject::Parse(card(false)).GetNamedArray(L"body");
    if (body.Size() != verbs.size())
        return 1;
    for (uint32_t i = 0; i < body.Size(); ++i)
    {
        auto action = body.GetObjectAt(i).GetNamedArray(L"actions").GetObjectAt(0);
        if (action.GetNamedString(L"verb") != verbs[i] || action.GetNamedString(L"type") != L"Action.Execute")
            return 2;
    }
    if (JsonObject::Parse(card(true)).GetNamedArray(L"body").Size() != 4)
        return 3;
    return 0;
}
#endif